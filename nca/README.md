# NCA - Núcleo de Cuidado ao Atleta

Sistema de monitoramento de atletas - Clone do Brazil Lacrosse adaptado para português com suporte a múltiplas modalidades esportivas.

## Estrutura

```
/app/nca/
├── backend/
│   ├── server.py          # FastAPI backend
│   ├── pdf_export_service.py
│   ├── requirements.txt
│   └── .env
└── frontend/
    ├── src/
    ├── public/
    │   └── nca-logo.png   # Logo do NCA
    ├── package.json
    └── .env
```

## Credenciais Padrão

- **Admin**: `admin@nca.com.br` / `admin123`

## Modalidades Disponíveis

- Futebol
- Futevôlei
- CrossFit
- Corrida
- Musculação
- Vôlei
- Basquete
- Handebol
- Tênis
- Natação
- Triathlon
- Outro (campo livre)

## Para Deploy no Emergent

### Opção 1: Criar novo projeto
1. Acesse o Emergent e crie um novo projeto
2. Copie os arquivos de `/app/nca/backend/` para `/app/backend/`
3. Copie os arquivos de `/app/nca/frontend/` para `/app/frontend/`
4. Configure as variáveis de ambiente

### Opção 2: Download e upload
1. Use o botão "Download" no Emergent para baixar o projeto NCA
2. Crie um novo projeto no Emergent
3. Faça upload dos arquivos

## Variáveis de Ambiente

### Backend (.env)
```
MONGO_URL=mongodb://localhost:27017
DB_NAME=nca_athletes
JWT_SECRET=nca_jwt_secret_key_2024
```

### Frontend (.env)
```
REACT_APP_BACKEND_URL=https://performance-fueling.preview.emergentagent.com
```

## Funcionalidades

- ✅ Login/Registro em Português
- ✅ Tema Preto e Branco
- ✅ Modalidades em vez de Times
- ✅ Campo Sexo (Masculino/Feminino)
- ⏳ Dashboard Staff (tradução pendente)
- ⏳ Formulários de Check-in (tradução pendente)
- ⏳ Gráficos e Analytics (tradução pendente)

## Status da Tradução

### Traduzido:
- [x] Login
- [x] Registro de Atleta
- [x] Registro de Profissional
- [x] Mensagens de erro do backend

### Pendente:
- [ ] AthleteHome
- [ ] StaffDashboard
- [ ] Formulários (Morning, Training, Recovery)
- [ ] Gráficos e tooltips
- [ ] Página de alertas
- [ ] Painel Admin
- [ ] CMJ Module
