# Decisiones

- El backend se publicará en Render Free porque el requisito es no generar cobros. No se agregará un método de pago. El servicio gratuito se duerme después de 15 minutos sin tráfico y puede tardar alrededor de un minuto en despertar.
- La base seguirá en Neon y el frontend en Vercel Hobby. Este plan de Vercel solo admite uso personal/no comercial. Se mantendrá el proyecto en planes gratuitos y sin método de pago.
- Se mantiene Neon, como pide el stack del plan. El proyecto solo necesita PostgreSQL; las funciones de autenticación y almacenamiento de Supabase no se usan en este MVP.
- Los intervalos iniciales son camión 250 h, excavadora 500 h y perforadora 300 h. Para cambiarlos hace falta una migración nueva; la app no tiene una pantalla administrativa para editarlos.
- Las notas de mantenimiento se recortan y limitan a 1000 caracteres; una nota vacía se guarda como `NULL`.
- Las migraciones registran un SHA-256 además del nombre. Un archivo aplicado que cambie después provoca un error, en lugar de alterar el historial silenciosamente.
- Render y Neon se administran por sus API y cadenas de conexión desde `deploy.sh`; Vercel se administra con su CLI oficial. Los tokens y URLs de conexión solo viven en el `.env.deploy` ignorado.
