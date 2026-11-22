# Vazamento de dados pessoais (SEV1)

> Os prazos e obrigações abaixo seguem a LGPD e a regulamentação da ANPD sobre comunicação de incidentes de segurança. **Confirmar com o jurídico e o DPO** no momento do incidente: esta página não é parecer jurídico.

**Dados que o projeto guarda:**
- e-mail;
- carteiras ligadas;
- dados do KYC (no provedor ou na revisão manual);
- IP e aparelho do antifraude;
- logs.

## 1. Conter

1. Fechar o acesso: revogar a credencial usada, isolar o servidor ou bucket e trocar os segredos afetados (tokens internos, chaves de banco).
2. Preservar a evidência: logs de acesso e cópia do que saiu, se houver.
3. Chamar o **DPO** e o **jurídico** na primeira hora.

## 2. Avaliar

- Que dados, de quantos titulares e desde quando.
- Risco ou dano relevante aos titulares? (dados de KYC e documento são sensíveis)
- O incidente continua?

## 3. Comunicar

- **ANPD e titulares:** quando houver risco ou dano relevante, a comunicação deve ser feita no prazo da regulamentação da ANPD (hoje, **3 dias úteis** a partir do conhecimento, conferir com o jurídico).
  - Conteúdo da comunicação: o que aconteceu, que dados, o que foi feito e o que o titular deve fazer.
  - Modelo em [comunicacao.md](../comunicacao.md#5-dados-pessoais), ajustado pelo jurídico.
- **Registro:** manter o registro do incidente, mesmo quando não houver comunicação.

## 4. Depois

- Pós-incidente.
- Revisar a retenção mínima: apagar o que não precisa ser guardado.
- Revisar os acessos ao KYC.
