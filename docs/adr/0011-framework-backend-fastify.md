# ADR-0011 — Fastify como framework do backend

- **Status:** Proposto
- **Data:** 2026-10-31
- **Trilhas afetadas:** backend · infra

## Contexto
O doc 05 §4 deixa o gateway entre NestJS e Fastify, e a trilha de backend pede a escolha em ADR antes do primeiro serviço. Regras de domínio não podem depender de framework (padrões de código).

## Opções consideradas
1. NestJS: estrutura pronta e injeção de dependências, com mais código e mais acoplamento.
2. Fastify: pequeno, rápido e com rate limit oficial; a estrutura fica por conta das camadas `api/`, `domain/` e `infra/`.

## Decisão
Fastify 5 com TypeScript estrito, validação com Zod e pnpm workspace. O domínio acessa a persistência por portas, como `AuthStore`.

## Consequências
O domínio é testável sem banco e sem HTTP. A estrutura de cada serviço depende de disciplina, não do framework. O ORM continua pendente: a escolha entre Prisma, Drizzle e Knex entra com o adaptador Postgres, e até lá o gateway só roda com armazenamento em memória e recusa subir em produção.
