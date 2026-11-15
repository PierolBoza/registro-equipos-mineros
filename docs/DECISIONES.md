# Decisiones

- El backend se publicará en Render con el plan gratuito porque el requisito es no generar cobros. No se agregará un método de pago; si se agota una cuota, Render suspende el servicio o detiene nuevos builds hasta el siguiente periodo.
- La base seguirá en Neon y el frontend en Vercel Hobby, ambos dentro de sus límites gratuitos. Vercel Hobby se usará para un proyecto personal/no comercial.
- Los intervalos de mantenimiento son valores iniciales configurables: camión 250 h, excavadora 500 h y perforadora 300 h.
- Las notas de mantenimiento se recortan y limitan a 1000 caracteres; una nota vacía se guarda como `NULL`.
- Las migraciones registran un SHA-256 además del nombre. Un archivo aplicado que cambie después provoca un error, en lugar de alterar el historial silenciosamente.
