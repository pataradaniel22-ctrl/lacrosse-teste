# Instruções do projeto (lacrosse-teste)

App **AMS Brasil Lacrosse** (monitoramento de atletas): backend FastAPI + MongoDB,
frontend React (CRA + craco, Tailwind, shadcn). Versão de teste hospedada fora do
Emergent. O app original (`lacrosse2`) continua no Emergent: **nunca altere o
repositório `lacrosse2`** a menos que o usuário peça explicitamente.

O usuário vem do Emergent e espera o mesmo fluxo de trabalho de lá. Ele não é
programador: fale sempre em **português**, de forma simples, sem jargão.

## Onde fica cada coisa

- Endereços, serviços e variáveis de ambiente: `HOSPEDAGEM.md`
- Requisitos e funcionalidades do produto: `memory/PRD.md` (mantenha atualizado)
- Histórico de testes do Emergent: `test_result.md`, `test_reports/iteration_*.json`
- Testes de backend (pytest): `backend/tests/`
- Ferramentas de QA: `qa/screenshots.js` (prints) e `qa/security_check.py` (segurança)

## Publicação

Push na branch `main` = deploy automático (Vercel para o site, Render para o
backend), em 3–5 minutos. Não existe ambiente de homologação: tudo que vai para
`main` vai para o ar.

## Fluxo obrigatório a cada pedido de mudança (igual ao Emergent)

1. **Entender e planejar.** Confirmar em uma frase o que vai ser feito. Se o pedido
   for ambíguo ou arriscado (apagar dados, mexer em login/permissões), perguntar
   antes. Criar uma lista de tarefas quando houver mais de 2 passos.
2. **Implementar** no menor escopo possível, seguindo o estilo do código existente
   (UUIDs em vez de ObjectId, excluir `_id` nas respostas, `data-testid` em
   elementos interativos novos, textos da interface em português).
3. **Testar antes de publicar:**
   - Backend: `python -m py_compile` nos arquivos alterados; rodar os testes de
     `backend/tests/` relacionados ao módulo, se as dependências estiverem
     disponíveis; criar/atualizar um teste pytest para a funcionalidade nova.
   - Frontend: `CI=false npm run build` em `frontend/` quando possível.
   - Se o ambiente não permitir instalar dependências, dizer isso claramente no
     relatório (nunca afirmar que testou algo que não testou).
4. **Revisão de segurança do que mudou** (checklist abaixo).
5. **Publicar:** commit com mensagem clara em português e push na `main`.
6. **Verificar no ar** (aguardar o deploy, ~5 min):
   - `python3 qa/security_check.py --json /tmp/security.json`
   - `node qa/screenshots.js <pasta> <rotas afetadas>` — tira prints em celular e
     computador e registra erros de console/rede em `report.json`.
   - Conferir `/api/` do backend respondendo 200.
7. **Relatório final ao usuário** (formato abaixo), **enviando os prints** com
   `SendUserFile`.
8. **Atualizar a memória do projeto:** `memory/PRD.md` (o que foi feito, data) e,
   se houver novas contas de teste, `memory/test_credentials.md` (arquivo
   ignorado pelo git; nunca colocar senhas reais no repositório).

Se o site/backend publicados não forem acessíveis deste ambiente (rede
bloqueada), avisar o usuário e pedir que libere os domínios em
Configurações → Capacidades do claude.ai, ou que mande prints.

## Checklist de segurança (toda mudança)

- Rota nova exige login (`Depends(get_current_user)`) e checa o papel certo
  (atleta só vê os próprios dados; rotas de admin checam `role == Admin`).
- Nenhuma resposta devolve `password_hash`, `_id` ou dados de outro atleta.
- Uploads validam tipo e tamanho.
- Nenhuma senha, chave ou `MONGO_URL` no código ou no chat; segredos só nas
  variáveis de ambiente do Render/Vercel.
- Nada de rotas públicas que alterem dados.
- Rodar `qa/security_check.py` depois do deploy e comparar com o resultado anterior.

Pendências de segurança conhecidas (não corrigir sem o usuário pedir):
- `/api/seed-demo` é público e cria dados/contas de demonstração.
- Contas demo com senhas fracas (ex.: admin `cristina.velez@brasillacrosse.com`) —
  o usuário pediu para manter.
- Não existe tela de "alterar senha".
- `CORS_ORIGINS="*"` no Render.

## Formato do relatório final

```
✅ O que mudou: <1–3 frases, linguagem simples>
🧪 Testes: backend <x/y> · build do site <ok/falhou/não rodado (motivo)>
🔒 Segurança: <n> falhas · <n> avisos (destacar o que é novo)
📸 Prints: <enviados / motivo de não enviar>
⚠️ Atenção: <problemas encontrados ou o que o usuário precisa fazer>
➡️ Próximo passo sugerido: <um, se houver>
```
