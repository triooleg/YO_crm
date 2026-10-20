# Architecture

Yoleotard CRM is a modular monolith. Next.js owns presentation and browser
session behavior. NestJS owns validation, authorization, business rules and
persistence. Prisma is the only database access layer.

Cross-module mutations use explicit services and database transactions. Important
state transitions append Activity and AuditLog records. Redis is for rate
limiting, coordination and future queues, never primary data.
