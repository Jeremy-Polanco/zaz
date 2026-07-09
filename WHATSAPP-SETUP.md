# WhatsApp (Meta Cloud API) — Setup para OTP login + notificaciones

El código ya está listo y desplegado. Lo ÚNICO que falta es la configuración
del lado de Meta y las variables de entorno en DigitalOcean. Este documento es
el paso a paso completo.

## Qué habilita esto

| Feature | Template requerido | Categoría Meta | Env var |
|---|---|---|---|
| OTP login (código de verificación) | autenticación | Authentication | `WHATSAPP_OTP_TEMPLATE_NAME` |
| Tracking de pedido (recibido / cotizado / confirmado / en ruta / entregado / cancelado) | 2 variables: nombre + estado | Utility | `WHATSAPP_ORDER_TEMPLATE_NAME` |
| Recordatorio 8 días sin pedir (win-back, diario 11:00 NJ) | 1 variable: nombre | Marketing | `WHATSAPP_WINBACK_TEMPLATE_NAME` |

Mientras las env vars no estén configuradas, TODO funciona igual que hoy:
login phone-only, y las notificaciones se saltan con un log (`TEMPLATE
SKIPPED`). Cero riesgo en desplegar el código antes de la config.

## Paso 1 — Meta Business + WhatsApp Business Account (WABA)

1. Entra a [business.facebook.com](https://business.facebook.com) con la cuenta
   del negocio (Udash) y crea/usa el **Business Portfolio**.
2. Ve a [developers.facebook.com/apps](https://developers.facebook.com/apps) →
   **Create App** → tipo **Business** → vincúlala al portfolio.
3. En la app, agrega el producto **WhatsApp**. Esto crea automáticamente una
   **WABA** de prueba con un número de test.
4. **Agrega el número real del negocio** (WhatsApp Manager → Phone numbers →
   Add). ⚠️ El número NO puede estar registrado en la app normal de WhatsApp /
   WhatsApp Business app — si lo está, primero elimínalo de esa app (Settings →
   Delete account; el chat history se pierde para ese número).
5. Verifica el negocio (Business Settings → Security Center → **Business
   verification**). Sin esto quedas limitado a 250 conversaciones/día — para
   empezar alcanza, pero inicia el trámite ya porque tarda días.

## Paso 2 — Credenciales permanentes (System User token)

El token que da la consola de desarrollador expira en 24h. Para producción:

1. Business Settings → Users → **System users** → Add (`dashgo-api`, rol Admin).
2. Al system user: **Add assets** → Apps → tu app (Full control) y la WABA.
3. **Generate token** → selecciona la app → permisos: `whatsapp_business_messaging`
   + `whatsapp_business_management` → expiración **Never**.
4. Guarda ese token: será `WHATSAPP_ACCESS_TOKEN`.
5. El **Phone number ID** (numérico, NO es el teléfono) está en WhatsApp
   Manager → Phone numbers → clic en el número: será `WHATSAPP_PHONE_NUMBER_ID`.

## Paso 3 — Crear los 3 templates (WhatsApp Manager → Message templates)

Los nombres son sugerencias — lo que importa es que coincidan con las env vars.

**1. `dashgo_otp` — categoría Authentication, idioma `es`**
Meta genera el texto automáticamente para esta categoría ("<código> es tu
código de verificación"). Activa la opción **Copy code** button (el código ya
la soporta; si eliges un template sin botón, setea
`WHATSAPP_OTP_TEMPLATE_HAS_BUTTON=false`).

**2. `dashgo_order_update` — categoría Utility, idioma `es`**
```
Hola {{1}}, {{2}}
```
Ejemplo de relleno que envía el backend: {{1}} = "Ana", {{2}} = "¡tu pedido va
en camino! Pronto llega a tu puerta."

**3. `dashgo_winback` — categoría Marketing, idioma `es`**
```
Hola {{1}} 👋 Hace más de una semana que no pides en Udash. Tu colmado te
extraña — entra a la app y pide lo de siempre 🛒
```
(Ajusta el copy a gusto; 1 sola variable. Marketing tarda más en aprobarse.)

La aprobación de templates suele tomar de minutos a 24h (Authentication es
casi instantáneo, Marketing es el más lento).

## Paso 4 — Env vars en DigitalOcean (app `zaz-dashgo-api`)

```
WHATSAPP_PHONE_NUMBER_ID=<numérico del paso 2.5>
WHATSAPP_ACCESS_TOKEN=<system user token del paso 2.4>
WHATSAPP_OTP_TEMPLATE_NAME=dashgo_otp
WHATSAPP_ORDER_TEMPLATE_NAME=dashgo_order_update
WHATSAPP_WINBACK_TEMPLATE_NAME=dashgo_winback
```

Puedes configurarlas por fases: primero las de notificaciones (order/winback)
y dejar el OTP para el final.

## Paso 5 — Encender el OTP login (el último switch)

Cuando el template de autenticación esté aprobado y probado:

```
AUTH_OTP_MODE=whatsapp
```

⚠️ IMPORTANTE antes de encenderlo:
- Con `AUTH_OTP_MODE=whatsapp` en producción, el boot FALLA si falta alguna de
  las 3 vars de WhatsApp (guard del env.schema — es intencional).
- **App Review de Apple**: el login pasa a requerir un código que el reviewer
  no puede recibir. Configura un teléfono demo con `AUTH_BYPASS_PHONES` (rango
  +1555555XXXX) + `AUTH_BYPASS_OTP_CODE` (código random de 6 dígitos, NO
  000000) y ponlo en las notas de revisión de App Store Connect.
- Prueba primero con `AUTH_OTP_MODE=sandbox` y tu propio número si quieres
  validar el template sin el guard estricto de producción.

## Costos (referencia, EE.UU.)

- Authentication: ~US$0.0135 por conversación de 24h.
- Utility: ~US$0.004 por mensaje dentro de ventana / conversación.
- Marketing: ~US$0.025 por conversación.
- Con "remember device" (sesiones de 365 días), el OTP se paga UNA vez por
  dispositivo, no por uso.
