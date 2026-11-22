<?php
// Perguntas frequentes (E4.5). Respostas curtas, sem promessa de rendimento (doc 10 §3).
// Grupos na ordem da página; cada item: [pergunta, resposta]. Texto puro (passa por e()).
return [
    'O jogo' => [
        ['O que é o Smart Chain City?', 'Um jogo de cidade em 3D no navegador. Você tem um avatar com profissão, trabalha em turnos, cuida da saúde e da felicidade, compra lotes, constrói imóveis e participa da economia da cidade.'],
        ['Preciso pagar para jogar?', 'Para jogar com recompensas, você precisa de um avatar, que vem da Lucky Box. Comer, se divertir e cuidar do avatar custa THALER, a moeda do jogo.'],
        ['O que é THALER e o que é SCITY?', 'THALER é a moeda do dia a dia dentro do jogo: salário, comida, impostos. SCITY é o token na BNB Smart Chain: compra de lotes, GamePass e câmbio. O câmbio entre os dois usa a cotação média de 24 h, com spread e teto diário.'],
        ['O que acontece se eu parar de cuidar do avatar?', 'Os atributos caem com o tempo. Com saúde ou energia baixas, ele não trabalha. Sem comer por 48 h, o turno não gera recompensa.'],
    ],
    'Lotes e imóveis' => [
        ['Como compro um lote?', 'No mapa, clique num lote verde e compre pela ficha, pagando SCITY. Cada jogador fica em um bairro por região, com até 30% da área do bairro. Nos lançamentos, a compra passa por uma fila com limite por carteira.'],
        ['Por que existe fila no lançamento?', 'Para ninguém comprar tudo com robôs. Quem chega antes da abertura tem a posição sorteada, e as entradas vão em lotes por minuto. Na sua vez, você tem 10 minutos para comprar.'],
        ['Imóvel virtual dá direito a imóvel real?', 'Não. Os lotes e imóveis do jogo são virtuais, mesmo nas cidades que copiam o mapa de cidades reais.'],
        ['Que impostos existem?', 'Lote vazio paga um imposto que cresce a cada mês sem uso. Com imóvel, a taxa é menor e fixa. Dívida de muitos meses leva o lote a leilão.'],
    ],
    'Carteira e segurança' => [
        ['Como deposito e saco SCITY?', 'Ligue sua carteira à conta. O depósito vai da carteira para o cofre do jogo (GameVault) e vira saldo depois das confirmações da rede. O saque gera um voucher que sua carteira resgata no cofre em até 48 h.'],
        ['Por que o saque tem limite?', 'O cofre tem teto diário, total e por carteira, que protege todos os jogadores num incidente. Saques maiores pedem verificação de identidade.'],
        ['Vi uma mensagem oferecendo ajuda ou airdrop. É real?', 'A equipe nunca pede sua seed, chave privada ou senha, e nunca começa conversa privada. Os únicos endereços oficiais estão na página Contratos oficiais.'],
        ['Os contratos foram auditados?', 'Os contratos passam por auditoria externa antes da mainnet. O relatório fica publicado no rodapé do site. Mudanças de parâmetro esperam 48 h num timelock, e a pausa de emergência é de um multisig.'],
        ['O que acontece se algo der errado?', 'Há um plano de resposta a incidentes: a operação pode suspender saques e câmbio na hora para proteger o cofre, e os saldos continuam registrados. Avisos saem no Discord e no site.'],
    ],
    'Token e risco' => [
        ['Ganhar no jogo é garantido?', 'Não. As recompensas dependem do seu avatar, da sua dedicação e da economia da cidade. O preço do SCITY varia e pode cair. Jogue pelo jogo e não invista o que não pode perder.'],
        ['Como o SCITY foi distribuído?', 'A oferta fixa de 1 bilhão foi distribuída no lançamento por contrato, com vesting para a equipe e os parceiros (cliff de 12 meses para a equipe). O pool de recompensas libera em parcelas anuais, e a liquidez inicial fica travada por pelo menos 12 meses. Os endereços estão em Contratos oficiais.'],
        ['Menores de idade podem jogar?', 'A Lucky Box e a compra de tokens são só para maiores de 18 anos.'],
    ],
];
