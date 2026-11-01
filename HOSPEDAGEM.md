# Hospedagem do lacrosse-teste

Versão de teste do app, hospedada fora do Emergent. O app original
(`lacrosse2`) continua no Emergent e não é afetado por este repositório.

## Endereços

| Parte | Serviço | Endereço |
|---|---|---|
| Site (React) | Vercel | https://lacrosse-teste-virid.vercel.app |
| Backend (FastAPI) | Render | https://lacrosse-teste-api.onrender.com |
| Banco de dados | MongoDB Atlas | `cluster0.sanvyfd.mongodb.net` (região São Paulo) |

Fotos e PDFs ficam guardados no próprio MongoDB (GridFS, coleção `uploads`).

## Como publicar uma mudança

Basta enviar para a branch `main` no GitHub. O Vercel e o Render publicam
sozinhos em 3–5 minutos.

## Configurações (preenchidas nos painéis, nunca no código)

**Render → lacrosse-teste-api → Environment**
- `MONGO_URL`: endereço de conexão do MongoDB Atlas (com a senha do usuário `pataradaniel22_db_user`)
- `ADMIN_INITIAL_PASSWORD`: senha inicial do admin `pataradaniel@gmail.com`
- `JWT_SECRET`: gerado automaticamente pelo Render
- `DB_NAME`, `CORS_ORIGINS`, `VAPID_CONTACT_EMAIL`: definidos em `render.yaml`

**Vercel → lacrosse-teste → Settings → Environment Variables**
- `REACT_APP_BACKEND_URL` = `https://lacrosse-teste-api.onrender.com`

## Observações

- O plano gratuito do Render "dorme" após 15 minutos sem uso; o primeiro acesso depois disso pode levar cerca de 1 minuto.
- As chaves de notificação push são geradas automaticamente e salvas no banco (coleção `app_settings`).
