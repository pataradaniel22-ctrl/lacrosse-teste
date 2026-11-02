# Hospedagem do lacrosse-teste

Versão de teste do app, hospedada fora do Emergent. O app original
(`lacrosse2`) continua no Emergent e não é afetado por este repositório.

## Endereços

| Parte | Serviço | Endereço |
|---|---|---|
| Site (React) | Vercel | https://dailycbl.com (domínio comprado no Vercel) · também https://lacrosse-teste-virid.vercel.app |
| Backend (FastAPI) | Render | https://lacrosse-teste-api.onrender.com |
| Banco de dados | MongoDB Atlas (projeto `lacrosse-eua`) | `cluster0.v9cvq1j.mongodb.net` (AWS N. Virginia, us-east-1) |

Fotos e PDFs ficam guardados no próprio MongoDB (GridFS, coleção `uploads`).

## Como publicar uma mudança

Basta enviar para a branch `main` no GitHub. O Vercel e o Render publicam
sozinhos em 3–5 minutos.

## Configurações (preenchidas nos painéis, nunca no código)

**Render → lacrosse-teste-api → Environment**
- `MONGO_URL`: endereço de conexão do MongoDB Atlas (com a senha do usuário `pataradaniel22_db_user`)
- `ADMIN_INITIAL_PASSWORD`: senha inicial do admin `pataradaniel@gmail.com`
- `JWT_SECRET`: gerado automaticamente pelo Render
- `DB_NAME`, `CORS_ORIGINS`, `VAPID_CONTACT_EMAIL`, `GOOGLE_CLIENT_ID`: definidos em `render.yaml`
  (`GOOGLE_CLIENT_ID` é público: ID do cliente OAuth do projeto Google Cloud "AMS Brasil Lacrosse"; vazio = botão do Google escondido)

**Vercel → lacrosse-teste → Settings → Environment Variables**
- `REACT_APP_BACKEND_URL` = `https://lacrosse-teste-api.onrender.com`

## Observações

- O plano gratuito do Render "dorme" após 15 minutos sem uso. Para evitar isso, o
  cron-job.org (job "Manter lacrosse acordado") acessa `/api/` a cada 10 minutos.
- Backend (Render, Virginia) e banco (Atlas, us-east-1) ficam na mesma região, perto
  dos atletas nos EUA. O banco antigo em São Paulo (`cluster0.sanvyfd`, "Project 0")
  não é mais usado.
- O login leva ~1,7 s por causa da verificação de senha (bcrypt) no servidor gratuito.
- As chaves de notificação push são geradas automaticamente e salvas no banco (coleção `app_settings`).
- Modo Demonstração: os dados do atleta de teste ficam no banco `lacrosse_teste_sandbox` (mesmo cluster). Para apagar tudo,
  use Admin → Demo mode → Clear demo data.

