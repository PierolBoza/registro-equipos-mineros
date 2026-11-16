import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';

const apiRoot = 'https://api.render.com/v1';
const apiKey = required('RENDER_API_KEY');
const ownerId = required('RENDER_OWNER_ID');
const serviceName = required('RENDER_SERVICE_NAME');
const repository = required('GITHUB_REPO_URL');
const branch = required('GITHUB_BRANCH');
const databaseUrl = required('DATABASE_URL');
const frontendUrl = required('FRONTEND_URL');
const serviceIdOverride = process.env.RENDER_SERVICE_ID?.trim();

class DeployFailure extends Error {
  constructor(message, code) {
    super(message);
    this.code = code;
  }
}

async function api(path, options = {}) {
  const response = await fetch(`${apiRoot}${path}`, {
    ...options,
    signal: AbortSignal.timeout(15_000),
    headers: {
      accept: 'application/json',
      authorization: `Bearer ${apiKey}`,
      ...(options.body ? { 'content-type': 'application/json' } : {}),
      ...options.headers,
    },
  });

  if (!response.ok) {
    if (response.status === 402) {
      throw new Error(
        'Render requiere información de pago para esta operación. No agregues una tarjeta; revisa el plan Free en el panel.',
      );
    }
    throw new Error(`Render API respondió HTTP ${response.status}.`);
  }

  const body = await response.text();
  return body ? JSON.parse(body) : null;
}

async function getService(serviceId) {
  return api(`/services/${encodeURIComponent(serviceId)}`);
}

async function findService() {
  if (serviceIdOverride) {
    const service = await getService(serviceIdOverride);
    if (service.ownerId !== ownerId || service.name !== serviceName) {
      throw new Error(
        'RENDER_SERVICE_ID no coincide con el servicio esperado.',
      );
    }
    return service;
  }

  const query = new URLSearchParams({
    ownerId,
    name: serviceName,
    limit: '100',
  });
  const entries = await api(`/services?${query.toString()}`);
  const matches = entries
    .map((entry) => entry.service)
    .filter(
      (service) =>
        service?.ownerId === ownerId && service?.name === serviceName,
    );

  if (matches.length > 1) {
    throw new Error('Hay más de un servicio Render con ese nombre.');
  }
  return matches[0] ?? null;
}

function normalizeRepository(value) {
  return value
    .trim()
    .replace(/\.git$/i, '')
    .replace(/\/$/, '')
    .toLowerCase();
}

function serviceConfiguration() {
  return {
    NODE_ENV: 'production',
    DATABASE_URL: databaseUrl,
    FRONTEND_URL: frontendUrl,
  };
}

async function createService() {
  const envVars = Object.entries(serviceConfiguration()).map(
    ([key, value]) => ({
      key,
      value,
    }),
  );
  const result = await api('/services', {
    method: 'POST',
    body: JSON.stringify({
      type: 'web_service',
      name: serviceName,
      ownerId,
      repo: repository,
      branch,
      autoDeployTrigger: 'off',
      envVars,
      serviceDetails: {
        runtime: 'docker',
        plan: 'free',
        region: 'oregon',
        numInstances: 1,
        healthCheckPath: '/health',
        envSpecificDetails: {
          dockerfilePath: './backend/Dockerfile',
          dockerContext: '.',
        },
      },
    }),
  });
  return { service: result.service, deployId: result.deployId, created: true };
}

async function listDeployments(serviceId) {
  const deployments = await api(
    `/services/${encodeURIComponent(serviceId)}/deploys?limit=20`,
  );
  return deployments.map((entry) => entry.deploy).filter(Boolean);
}

async function writeServiceEnvironment(serviceId) {
  for (const [key, value] of Object.entries(serviceConfiguration())) {
    await api(
      `/services/${encodeURIComponent(serviceId)}/env-vars/${encodeURIComponent(key)}`,
      { method: 'PUT', body: JSON.stringify({ value }) },
    );
  }
}

async function triggerDeploy(serviceId) {
  return api(`/services/${encodeURIComponent(serviceId)}/deploys`, {
    method: 'POST',
    body: JSON.stringify({
      clearCache: 'do_not_clear',
      deployMode: 'build_and_deploy',
    }),
  });
}

function wait(milliseconds) {
  return new Promise((resolveWait) => setTimeout(resolveWait, milliseconds));
}

async function waitForDeployment(serviceId, deployId) {
  const finished = new Set([
    'live',
    'deactivated',
    'build_failed',
    'update_failed',
    'pre_deploy_failed',
    'canceled',
  ]);

  for (let attempt = 0; attempt < 60; attempt += 1) {
    const deployment = await api(
      `/services/${encodeURIComponent(serviceId)}/deploys/${encodeURIComponent(deployId)}`,
    );
    if (finished.has(deployment.status)) return deployment;
    await wait(5_000);
  }
  throw new Error(
    'Render no terminó el despliegue dentro del tiempo esperado.',
  );
}

async function waitForHealth(url) {
  for (let attempt = 0; attempt < 12; attempt += 1) {
    try {
      const response = await fetch(`${url}/health`, {
        signal: AbortSignal.timeout(10_000),
      });
      if (response.ok) {
        const body = await response.json();
        if (body.status === 'ok' && body.db === 'up') return true;
      }
    } catch {
      // El servicio gratuito puede tardar en arrancar o estar reiniciándose.
    }
    if (attempt < 11) await wait(5_000);
  }
  return false;
}

async function rollback(serviceId, priorDeploy, serviceUrl) {
  if (!priorDeploy) {
    console.error('No hay un despliegue previo que se pueda restaurar.');
    return false;
  }

  const rollbackDeploy = await api(
    `/services/${encodeURIComponent(serviceId)}/rollback`,
    {
      method: 'POST',
      body: JSON.stringify({ deployId: priorDeploy.id }),
    },
  );
  const result = await waitForDeployment(serviceId, rollbackDeploy.id);
  if (result.status !== 'live') {
    console.error('Render no pudo activar el despliegue anterior.');
    return false;
  }
  const healthy = await waitForHealth(serviceUrl);
  if (!healthy) console.error('El despliegue restaurado no pasó /health.');
  return healthy;
}

async function main() {
  let service = await findService();
  let previousDeployment = null;
  let deploymentId = null;
  let created = false;

  if (!service) {
    const result = await createService();
    service = result.service;
    deploymentId = result.deployId;
    created = result.created;
  } else {
    if (service.type !== 'web_service') {
      throw new Error('El servicio Render existente no es un Web Service.');
    }
    if (
      normalizeRepository(service.repo ?? '') !==
      normalizeRepository(repository)
    ) {
      throw new Error('El servicio Render existente usa otro repositorio.');
    }
    if (service.branch && service.branch !== branch) {
      throw new Error('El servicio Render existente usa otra rama.');
    }
    if (service.serviceDetails?.plan !== 'free') {
      throw new Error('El Web Service de Render no está en el plan Free.');
    }

    const deployments = await listDeployments(service.id);
    previousDeployment =
      deployments.find((entry) => entry.status === 'live') ?? null;

    if (service.autoDeployTrigger !== 'off') {
      await api(`/services/${encodeURIComponent(service.id)}`, {
        method: 'PATCH',
        body: JSON.stringify({ autoDeployTrigger: 'off' }),
      });
    }
    await writeServiceEnvironment(service.id);
    const deployment = await triggerDeploy(service.id);
    deploymentId = deployment.id;
  }

  const serviceId = service?.id;
  if (!serviceId) throw new Error('Render no devolvió el ID del servicio.');

  service = await getService(serviceId);
  if (service.serviceDetails?.plan !== 'free') {
    throw new Error('Render no confirmó el plan Free del Web Service.');
  }
  const serviceUrl = service.serviceDetails?.url?.replace(/\/$/, '');
  if (!serviceUrl?.startsWith('https://')) {
    throw new Error('Render no devolvió la URL HTTPS del Web Service.');
  }

  if (!deploymentId) {
    const deployments = await listDeployments(serviceId);
    deploymentId = deployments[0]?.id ?? null;
  }
  if (!deploymentId)
    throw new Error('Render no devolvió el ID del despliegue.');

  const deployment = await waitForDeployment(serviceId, deploymentId);
  if (deployment.status !== 'live') {
    if (!created) await rollback(serviceId, previousDeployment, serviceUrl);
    throw new DeployFailure(
      `Render terminó con estado ${deployment.status}.`,
      40,
    );
  }

  if (!(await waitForHealth(serviceUrl))) {
    if (!created) await rollback(serviceId, previousDeployment, serviceUrl);
    else console.error('Primer despliegue: no existe una versión anterior.');
    throw new DeployFailure('El backend no pasó el health check.', 41);
  }

  const outputPath = resolve('.deploy.lock', 'backend-url');
  await mkdir(dirname(outputPath), { recursive: true });
  await writeFile(outputPath, serviceUrl, 'utf8');
  console.log('Backend desplegado y /health responde correctamente.');
}

function required(name) {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`Falta la variable ${name}.`);
  return value;
}

main().catch((error) => {
  console.error(
    error instanceof Error ? error.message : 'Falló el despliegue en Render.',
  );
  process.exitCode = error instanceof DeployFailure ? error.code : 1;
});
