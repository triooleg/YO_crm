# Yoleotard CRM project blueprint

## Product goal

One fast daily workspace showing who needs a reply, new and active orders,
missing measurements, production deadlines, payments, shipments, and the
complete history of any client.

## Lifecycle

Inquiry -> consultation -> model and price -> design approval -> deposit ->
production slot -> measurements/materials -> production -> photo -> final payment
-> shipment -> delivery -> review -> repeat order.

## Bounded contexts

1. Identity: users, roles, sessions and permissions.
2. CRM: clients, athletes, contacts, tags and timeline.
3. Sales: leads, orders, items, pipeline, designs and ready models.
4. Production: slots, calendar, tasks, deadlines and quality control.
5. Finance: invoices, payments, balances and PDFs.
6. Fulfilment: shipments, tracking and delivery.
7. Communication: Chatwoot/email references and templates.
8. Platform: files, integrations, settings, automation and audit.

## Architecture

Browser -> Next.js web -> NestJS REST API -> PostgreSQL / Redis / file storage.
The API owns authorization and business rules. Add a worker only when real
integration or automation load requires it.

## First production slice

An owner/admin can authenticate, create and find a client, add an athlete and
measurements, create an order, record its deposit, confirm its production slot,
and see the resulting audit timeline.
