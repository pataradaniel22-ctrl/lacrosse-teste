import { useState } from 'react';
import { Link } from 'react-router-dom';

const UPDATED = '2026-11-02';

const PRIVACY = {
  pt: {
    title: 'Política de Privacidade',
    intro: 'O AMS Brasil Lacrosse (Athlete Monitoring System) é usado pelas seleções da Brasil Lacrosse para acompanhar o bem-estar, a carga de treino, a recuperação e a saúde dos atletas. Esta política explica quais dados coletamos, para quê e como são protegidos, conforme a Lei Geral de Proteção de Dados (LGPD, Lei 13.709/2018).',
    sections: [
      ['Quem é o responsável', 'O controlador dos dados é a Brasil Lacrosse, responsável pelas seleções que usam o app. Dúvidas ou pedidos sobre seus dados podem ser feitos ao administrador da sua equipe, pelo próprio app (Mensagens) ou pessoalmente.'],
      ['Dados que coletamos', 'Cadastro: nome, e-mail, equipe e, se você enviar, foto de perfil. Monitoramento: respostas de check-in diário (sono, humor, dor, fadiga), registros de treino e de recuperação, questionários de saúde, nutrição e mensagens com a comissão técnica. Saúde: registros de lesões e doenças feitos pela equipe médica. Login com Google: apenas seu e-mail, nome e um identificador da conta Google — nunca a sua senha do Google.'],
      ['Dados sensíveis (saúde)', 'Informações de saúde são dados sensíveis pela LGPD. Elas são tratadas apenas para a tutela da saúde do atleta e o planejamento esportivo, e acessadas somente por quem precisa: dados clínicos detalhados só pela equipe médica/fisioterapia e administradores; técnicos veem apenas a disponibilidade para treino; relatórios de pesquisa usam dados agregados ou anonimizados.'],
      ['Para que usamos', 'Acompanhar a prontidão e prevenir lesões; planejar treinos e recuperação; registrar e acompanhar lesões e doenças; comunicação entre atleta e comissão técnica; estatísticas internas da equipe. Não vendemos dados, não usamos para publicidade e não compartilhamos com terceiros para fins comerciais.'],
      ['Com quem compartilhamos', 'Somente com os serviços que hospedam o app, que atuam como operadores e não usam os dados para outros fins: Vercel (site), Render (servidor) e MongoDB Atlas (banco de dados), com servidores nos Estados Unidos; e o Google, apenas para confirmar sua identidade quando você escolhe "Entrar com Google".'],
      ['Como protegemos', 'Conexão sempre criptografada (HTTPS); senhas guardadas apenas de forma cifrada (bcrypt); acesso por login com permissões por função; atletas só veem os próprios dados; segredos de acesso guardados fora do código.'],
      ['Por quanto tempo', 'Os dados são mantidos enquanto você fizer parte do programa e pelo tempo necessário para acompanhamento de saúde e obrigações legais. Depois disso podem ser apagados ou anonimizados.'],
      ['Seus direitos', 'Você pode pedir a qualquer momento: confirmação e acesso aos seus dados, correção, anonimização ou exclusão, informação sobre compartilhamento e revogação do consentimento. Basta falar com o administrador da sua equipe.'],
      ['Menores de idade', 'Atletas menores de 18 anos só usam o app com autorização do responsável legal.'],
      ['Alterações', 'Esta política pode ser atualizada; a data da última versão aparece abaixo.'],
    ],
  },
  en: {
    title: 'Privacy Policy',
    intro: 'AMS Brasil Lacrosse (Athlete Monitoring System) is used by the Brasil Lacrosse national teams to follow athletes\' wellness, training load, recovery and health. This policy explains what data we collect, why, and how it is protected, in line with Brazil\'s General Data Protection Law (LGPD).',
    sections: [
      ['Who is responsible', 'The data controller is Brasil Lacrosse, which runs the teams that use the app. Questions or requests about your data can be sent to your team administrator, through the app (Messages) or in person.'],
      ['Data we collect', 'Account: name, e-mail, team and, if you upload one, a profile photo. Monitoring: daily check-in answers (sleep, mood, soreness, fatigue), training and recovery logs, health questionnaires, nutrition and messages with staff. Health: injury and illness records entered by the medical staff. Sign in with Google: only your e-mail, name and a Google account identifier — never your Google password.'],
      ['Sensitive (health) data', 'Health information is sensitive data. It is used only to protect the athlete\'s health and plan training, and is accessed only by those who need it: detailed clinical data only by medical/physio staff and administrators; coaches see availability only; research reports use aggregated or anonymised data.'],
      ['How we use it', 'Monitoring readiness and preventing injuries; planning training and recovery; recording and following injuries and illnesses; athlete–staff communication; internal team statistics. We do not sell data, use it for advertising or share it with third parties for commercial purposes.'],
      ['Who we share it with', 'Only the services that host the app, acting as processors that do not use the data for anything else: Vercel (website), Render (server) and MongoDB Atlas (database), with servers in the United States; and Google, only to confirm your identity when you choose "Sign in with Google".'],
      ['How we protect it', 'Always-encrypted connections (HTTPS); passwords stored only in hashed form (bcrypt); login with role-based permissions; athletes see only their own data; access secrets kept outside the code.'],
      ['How long we keep it', 'Data is kept while you are part of the program and for as long as needed for health follow-up and legal obligations. After that it may be deleted or anonymised.'],
      ['Your rights', 'At any time you can ask for: confirmation of and access to your data, correction, anonymisation or deletion, information about sharing, and withdrawal of consent. Just contact your team administrator.'],
      ['Minors', 'Athletes under 18 use the app only with their legal guardian\'s authorization.'],
      ['Changes', 'This policy may be updated; the date of the latest version is shown below.'],
    ],
  },
};

const TERMS = {
  pt: {
    title: 'Termos de Uso',
    intro: 'Ao usar o AMS Brasil Lacrosse você concorda com estes termos.',
    sections: [
      ['Quem pode usar', 'O app é de uso exclusivo de atletas, comissão técnica e equipe médica das seleções da Brasil Lacrosse, com cadastro aprovado por um administrador.'],
      ['Sua conta', 'Você é responsável por manter sua senha em segurança e não compartilhar seu acesso. Avise o administrador se suspeitar de uso indevido.'],
      ['Uso correto', 'Informe dados verdadeiros. Não tente acessar dados de outras pessoas, burlar permissões ou atrapalhar o funcionamento do app. O acesso pode ser suspenso em caso de uso indevido.'],
      ['Não substitui atendimento médico', 'As informações e indicadores do app apoiam o acompanhamento esportivo, mas não substituem avaliação, diagnóstico ou tratamento por profissional de saúde. Em caso de emergência, procure atendimento imediatamente.'],
      ['Disponibilidade', 'Buscamos manter o app sempre no ar, mas podem ocorrer interrupções para manutenção ou por falhas dos serviços de hospedagem.'],
      ['Privacidade', 'O tratamento dos seus dados segue a nossa Política de Privacidade.'],
      ['Alterações', 'Estes termos podem ser atualizados; a data da última versão aparece abaixo.'],
    ],
  },
  en: {
    title: 'Terms of Use',
    intro: 'By using AMS Brasil Lacrosse you agree to these terms.',
    sections: [
      ['Who may use it', 'The app is for athletes, coaching staff and medical staff of the Brasil Lacrosse national teams only, with an account approved by an administrator.'],
      ['Your account', 'You are responsible for keeping your password safe and not sharing your access. Tell an administrator if you suspect misuse.'],
      ['Proper use', 'Provide truthful information. Do not try to access other people\'s data, bypass permissions or disrupt the app. Access may be suspended in case of misuse.'],
      ['Not medical care', 'The app\'s information and indicators support sports monitoring but do not replace assessment, diagnosis or treatment by a health professional. In an emergency, seek care immediately.'],
      ['Availability', 'We aim to keep the app online, but interruptions may occur for maintenance or because of hosting provider failures.'],
      ['Privacy', 'Your data is handled according to our Privacy Policy.'],
      ['Changes', 'These terms may be updated; the date of the latest version is shown below.'],
    ],
  },
};

function LegalPage({ content }) {
  const [lang, setLang] = useState(() => (navigator.language || '').toLowerCase().startsWith('pt') ? 'pt' : 'en');
  const c = content[lang];
  return (
    <div className="min-h-screen bg-background text-foreground px-4 py-10">
      <div className="max-w-2xl mx-auto space-y-6">
        <div className="flex items-center justify-between gap-4">
          <Link to="/login" className="flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground">
            <img src="/icon-96.png" alt="" className="w-8 h-8 rounded-lg" />
            AMS Brasil Lacrosse
          </Link>
          <div className="flex rounded-md border border-white/15 overflow-hidden text-xs">
            {['pt', 'en'].map((l) => (
              <button key={l} onClick={() => setLang(l)} data-testid={`legal-lang-${l}`}
                className={`px-3 py-1.5 ${lang === l ? 'bg-primary text-primary-foreground' : 'hover:bg-white/5'}`}>
                {l === 'pt' ? 'Português' : 'English'}
              </button>
            ))}
          </div>
        </div>
        <h1 className="text-3xl font-heading font-bold">{c.title}</h1>
        <p className="text-muted-foreground leading-relaxed">{c.intro}</p>
        {c.sections.map(([h, t]) => (
          <section key={h} className="space-y-1.5">
            <h2 className="text-lg font-semibold">{h}</h2>
            <p className="text-sm text-muted-foreground leading-relaxed">{t}</p>
          </section>
        ))}
        <p className="text-xs text-muted-foreground pt-4 border-t border-white/10">
          {lang === 'pt' ? 'Última atualização' : 'Last updated'}: {UPDATED} ·{' '}
          <Link to="/privacy" className="underline">{PRIVACY[lang].title}</Link> ·{' '}
          <Link to="/terms" className="underline">{TERMS[lang].title}</Link>
        </p>
      </div>
    </div>
  );
}

export function PrivacyPolicy() { return <LegalPage content={PRIVACY} />; }
export function TermsOfUse() { return <LegalPage content={TERMS} />; }
