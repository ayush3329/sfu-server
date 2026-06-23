# DriveAssist AI — Citizen Transport Assistant

**Software Requirements Specification (SRS) v1.0**  
**Classification: Internal | Confidential**

---

## Table of Contents

1. [Project Overview](#project-overview)
2. [Purpose & Scope](#purpose--scope)
3. [Key Definitions](#key-definitions)
4. [Technology Stack](#technology-stack)
5. [System Architecture](#system-architecture)
6. [Agentic Tool Calling](#agentic-tool-calling)
7. [System Constraints & Requirements](#system-constraints--requirements)
8. [User Stories](#user-stories)
9. [API Specifications](#api-specifications)
10. [Knowledge Base Structure](#knowledge-base-structure)

---

## Project Overview

**Project Name:** DriveAssist AI — Citizen Transport Assistant

**Document Type:** Software Requirements Specification (SRS)

**Version:** 1.0

**Governing Legislation:**
- Motor Vehicles Act 1988 (as amended)
- Central Motor Vehicles Rules 1989
- MV Amendment Act 2019

**Total User Stories:** 30 (US-01 to US-30)

---

## Purpose & Scope

### Purpose

DriveAssist AI is an intelligent RAG-powered and Agentic conversational assistant built using Spring AI. It:

- Answers citizen and transport-office queries using a governed transport knowledge base
- Guides citizens through license and vehicle procedures
- Escalates complex or disputed cases to human RTO officials

Version 1.0 extends the RAG-only architecture with an Agentic Tool Calling layer using Spring AI's Tool Calling API, enabling the assistant to perform multi-step reasoning and invoke up to 5 registered tools.

### Scope

DriveAssist AI serves citizens and transport administrators across:

- **Driving License:** Application, renewal, endorsements, suspension, and cancellation (KB-DL-001)
- **Vehicle Registration:** New RC, renewal, ownership transfer, NOC (KB-VR-002)
- **Traffic Fines & Challans:** Issuance, payment, dispute, compounding, virtual court (KB-TF-003)
- **Permits:** National, state, tourist, commercial vehicle rules (KB-PM-004)
- **Grievance Redressal & Citizen Rights** (KB-GR-005)
- **Agentic Workflows:** Challan lookup, query transformation, appointment guidance, and escalation

### Out of Scope

DriveAssist AI does **NOT**:
- Adjudicate disputes
- Waive penalties
- Modify challans
- Access Vahan/Sarathi databases for write operations

All disputed or unclear cases are escalated to human RTO officials.

---

## Key Definitions

| Term | Definition |
|---|---|
| **RAG** | Retrieval-Augmented Generation — grounds LLM responses in verified KB documents; blocks hallucinated transport rules |
| **Agentic AI** | AI that autonomously selects and invokes tools to complete multi-step transport workflows |
| **Tool Calling** | Spring AI mechanism allowing LLM to invoke registered @Tool-annotated Java functions based on query intent |
| **KB** | Knowledge Base — centralized repository of RTO SOPs, traffic rules, fine schedules, and permit guidelines |
| **allowEmptyContext** | Spring AI flag — when false, blocks all LLM responses when no KB context is retrieved |
| **Azure OpenAI** | Microsoft-hosted OpenAI models (GPT-4o) used as primary LLM in production deployment |
| **Ollama** | Locally-hosted open-source LLM runtime (Mistral / LLaMA 3.2) used for local development and fallback |
| **Vahan** | National vehicle registration database (MoRTH) — read-only integration only |
| **Sarathi** | National DL database (MoRTH) — read-only integration only |

---

## Technology Stack

### Core Components

| Component | Technology / Detail |
|---|---|
| **Backend Framework** | Spring Boot 3.x |
| **AI Framework** | Spring AI (latest stable) — RAG, Tool Calling, embeddings, vector store |
| **Language** | Java 17+ |
| **Build System** | Maven or Gradle |
| **LLM** | Azure OpenAI — GPT-4o / GPT-4.1 (production) |
| **Embedding Model** | Azure OpenAI text-embedding-3-large |
| **Vector Store** | MariaDB with vector extension — cosine similarity search |
| **API Documentation** | Springdoc OpenAPI (Swagger UI at /swagger-ui) |

### LLM & Model Configuration

DriveAssist AI uses Spring AI's model abstraction layer, allowing seamless switching between Azure OpenAI (primary) and Ollama (local/fallback) without code changes.

| Configuration | Azure OpenAI (Primary) | Ollama (Local / Fallback) |
|---|---|---|
| **Model** | GPT-4o or GPT-4.1 (configurable) | mistral or llama3.2 (configurable) |
| **Embedding Model** | text-embedding-3-large (1536-dim) | mxbai-embed-large (1024-dim) |
| **Spring AI Config** | spring.ai.azure.openai.* | spring.ai.ollama.* |
| **Deployment** | Azure OpenAI Service endpoint + API key | Ollama running locally on port 11434 |
| **Use Case** | Production; citizen-facing deployments | Local development; offline RTO environments; fallback |
| **Streaming** | Supported (SSE via Spring WebFlux) | Supported (SSE via Spring WebFlux) |
| **Tool Calling** | Fully supported (GPT-4o function calling) | Supported (Ollama tool calling — model-dependent) |

**Configuration Note:** Set `spring.ai.active-model=azure` (production) or `spring.ai.active-model=ollama` (local) in application.properties. No code change required. API keys stored in environment variables.

---

## System Architecture

### Architecture Overview

DriveAssist AI is a single Spring Boot application integrating Spring AI components. It combines an Advanced RAG pipeline for grounded Q&A with an Agentic Tool Calling layer for multi-step transport workflows.

### RAG Flow

```
Citizen Query → PII Redaction → QueryTransformTool → Vector Retrieval (MariaDB, ≥0.7) 
→ Reranker → Prompt Augmentation + Citations → LLM (Azure/Ollama) → Grounded Response
```

### Agentic Flow (Tool Calling Active)

```
Citizen Query → Intent Classification → Tool Selection → Tool Invocation (LicenseServiceTool | ChallanServiceTool | …) 
→ Tool Result → KB Augmentation → LLM → Grounded Agentic Response
```

---

## Agentic Tool Calling

### Overview

DriveAssist AI v1.0 introduces a focused Agentic layer using Spring AI's Tool Calling API. The LLM can autonomously select and invoke one of 5 registered tools to handle multi-step transport workflows.

### Tool Invocation Flow

1. Citizen sends query to `/ai/chat/sync` or `/ai/chat/async`
2. LLM receives the query with the registered tool manifest (5 tool names + descriptions)
3. LLM determines whether a tool call is needed or if RAG retrieval alone suffices
4. If tool needed: LLM generates a ToolCall request with tool name and parameters
5. Spring AI dispatches the ToolCall to the corresponding @Tool-annotated Java method
6. Tool executes (KB retrieval, challan lookup, query transformation, escalation) and returns ToolResult
7. LLM incorporates ToolResult into the response with KB citations
8. Final response returned to citizen; all tool calls and results logged in audit trail

### Registered Tools (5 Tools)

| Tool Name | Description & When to Use | US Coverage | Safety Constraint |
|---|---|---|---|
| **LicenseServiceTool** | Handles all license and registration KB queries. When to use: query requires specific SOP steps, eligibility rules, or document checklists for DL/RC/Permit services from KB-DL-001, KB-VR-002, KB-PM-004. | US-10, US-11, US-12, US-15, US-19, US-23 | Read-only KB retrieval; no write to Sarathi or Vahan |
| **ChallanServiceTool** | Consolidated challan tool: looks up pending challans; retrieves penalty schedule. When to use: query requires live challan data by vehicle/DL number, or the exact penalty and MV Act section from KB-TF-003. | US-04, US-05, US-06, US-17, US-21, US-22 | Read-only; no payment initiation; disputed challans escalated |
| **QueryTransformTool** | Pre-retrieval pipeline: language detection, translation, query rewriting, multi-query expansion. When to use: query is vague, in a regional language, verbose, or would benefit from expansion before vector retrieval. | US-03, US-24, US-25 | Pre-retrieval only; no external API; runs before vector search |
| **EscalationTool** | Generates structured escalation with RTO office name, address, phone, and working hours. When to use: allowEmptyContext fires, confidence is below threshold, or query involves disputes, legal decisions, or court-referred challans. | US-07, US-13, US-30 | Reads RTO directory from system config; no external API call; mandatory for disputes |
| **KBIngestTool** | Admin-only tool: triggers KB document ingestion pipeline for uploaded transport policy PDFs/DOCXs. When to use: system admin uploads a new or updated policy document that must be chunked, embedded, and stored. | US-28 | Admin role required; POST /kb/ingest; validates doc_type, audience, version |

### Agentic Safety Guardrails

- All tool invocations logged with input parameters and outputs in the audit trail (`GET /audit/{workflowId}`)
- All tools are read-only — no tool writes to Vahan, Sarathi, or any government database
- PII (DL number, vehicle number, phone) redacted from audit logs before storage
- If a tool returns an error or empty result: agent falls back to KB retrieval or safe refusal via EscalationTool
- No tool has authority to waive penalties, cancel challans, or modify government records
- Maximum tool call chain depth: 3 sequential calls per query
- All agentic responses include KB citations and tool result source attribution

---

## System Constraints & Requirements

### General System Constraints (Mandatory)

#### Knowledge Grounding

- All responses must be strictly grounded in Knowledge Base (KB) documents
- No LLM-only or hallucinated responses are permitted
- `allowEmptyContext = false` must be enforced globally — no response generated when KB context is unavailable
- Retrieval similarity threshold must be ≥ 0.7 — low-confidence chunks must not be passed to the LLM
- Note: threshold could be reduced up to .5-.6

#### Response Citation Requirement

All responses must include citations referencing:
- Source Knowledge Base document
- Relevant section and page number used to generate the answer

#### Empty Context Handling

If no relevant KB content is retrieved, the system must return:

```json
{
  "answer": "No matching transport policy found. Please contact your nearest RTO.",
  "escalated": true,
  "citations": []
}
```

#### Session Traceability

- Every conversation session must have a unique UUID generated at initiation
- This ensures end-to-end traceability in audit logs

#### KB Ingestion Response

Upon successful document ingestion:
- HTTP Status: 201 Created
- Response Payload:

```json
{
  "documentId": "<id>",
  "chunks_created": "<count>",
  "ingestion_time_ms": "<time>",
  "metadata": "<details>"
}
```

#### PII Detection & Redaction

All Personally Identifiable Information (PII) must be detected and redacted before LLM processing.

| PII Type | Pattern Example | Redaction Token |
|---|---|---|
| Employee ID | EMP-12345, E0098 | [EMP-ID-REDACTED] |
| Salary / CTC | ₹12,00,000 / 12 LPA | [SALARY-REDACTED] |
| Bank Account Number | 1234 5678 9012 3456 | [BANK-REDACTED] |
| Aadhaar Number | 1234 5678 9012 | [AADHAAR-REDACTED] |
| PAN Card Number | ABCDE1234F | [PAN-REDACTED] |
| Personal Phone Number | +91 98765 43210 | [PHONE-REDACTED] |
| Personal Email Address | john.doe@gmail.com | [EMAIL-REDACTED] |
| Home Address | 123, MG Road, Bangalore 560001 | [ADDRESS-REDACTED] |
| Date of Birth | 15/08/1990 / Aug 15 1990 | [DOB-REDACTED] |

### Dynamic Metadata Filters

- `doc_type` == 'driving_license' | 'fine_schedule' | 'vehicle_registration' | 'permit' | 'grievance'
- `license_type` == 'learner' | 'permanent' | 'commercial'
- `vehicle_category` == 'two-wheeler' | 'four-wheeler' | 'heavy-motor'
- `violation_type` == 'overspeeding' | 'drunk_driving' | 'parking' | 'helmet'
- `permit_type` == 'national' | 'state' | 'tourist' | 'temporary'
- `region` == 'state-rto' | 'national' | 'all'

### Query Transformation (QueryTransformTool)

| Transformation | Description | Example |
|---|---|---|
| **Rewrite** | Converts vague citizen queries to precise retrieval queries | "DL expired" → "driving license renewal procedure and documents required" |
| **Compression** | Shortens long citizen narratives before retrieval | Long story → "e-challan notification payment query" |
| **Translation** | Regional language to English before vector search | Hindi/Tamil/Telugu query → English equivalent |
| **Multi-Query Expansion** | Single query → multiple retrieval queries | "Vehicle transfer" → ["ownership transfer", "RC change procedure", "Form 29 Form 30"] |
| **Deduplication** | Merge and deduplicate multi-query results | Removes duplicate KB chunks before reranking |

### Post-Retrieval Processing

| Process | Description |
|---|---|
| **Compression** | Reduces large RTO SOP texts into concise procedural summaries before LLM prompt |
| **Final Prompt** | Only top-N reranked chunks included; system prompt enforces citation requirement and safe refusal guardrail |

---

## User Stories

### What is Tool Calling?

Tool Calling is a Spring AI mechanism that allows the LLM to autonomously decide when a user query requires more than static KB retrieval — and then invoke a registered Java method (@Tool) to fetch live data, perform lookups, or trigger workflows.

**When to use Tool Calling:** Use a tool when the query requires (a) real-time data not available in static KB — e.g., pending challans by vehicle number; (b) multi-step reasoning across services — e.g., check challan → explain penalty → guide payment; (c) pre-retrieval transformation — e.g., language detection, query rewriting, expansion; or (d) structured escalation — e.g., routing to the correct RTO office with address and hours.

**When NOT to use Tool Calling:** Use standard RAG (marked "—") when the query can be fully answered from static KB documents — e.g., explaining a rule, describing a process, or listing documents required.

### Summary of All 30 User Stories

**Total User Stories:** 30 (US-01 to US-30)

**Coverage:**
- **Chat Q&A:** US-01, US-02
- **RAG Pipeline:** US-03
- **Fines:** US-04, US-05, US-06, US-07, US-08, US-09
- **Licensing:** US-10, US-11, US-12, US-13, US-14
- **Registration:** US-15, US-16, US-17, US-18
- **Permits:** US-19, US-20
- **Agentic Workflows:** US-21, US-22, US-23, US-24, US-25
- **API:** US-26, US-27, US-28, US-29
- **Escalation:** US-30

**Priority Breakdown:**
- **Critical:** US-01, US-02, US-04, US-10, US-11, US-15, US-26, US-27, US-28, US-30
- **High:** US-03, US-05, US-06, US-07, US-12, US-13, US-17, US-19, US-21, US-22, US-24, US-25, US-29
- **Medium:** US-08, US-09, US-14, US-16, US-18, US-20, US-23

---

## API Specifications

### Endpoints

| Method | Endpoint | Description | Priority |
|---|---|---|---|
| POST | `/ai/chat/sync` | Synchronous — accepts citizen query; returns complete grounded JSON with citations and tool results | Critical |
| POST | `/ai/chat/async` | Async SSE streaming — real-time token delivery via Spring WebFlux | Critical |
| GET | `/audit/{workflowId}` | Full audit trail: query, chunks, citations, tools invoked, inputs/outputs, filters, escalation flag | High |
| POST | `/kb/ingest` | Ingests PDF/DOCX transport policy document into vector store with metadata tags | High |
| GET | `/kb/documents` | Lists all ingested KB documents with metadata, version, and ingestion timestamp | Medium |
| GET | `/tools` | Lists all 5 registered Spring AI tools with name, description, and input schema | Medium |

### Request Body (POST /ai/chat/sync and /ai/chat/async)

```json
{
  "message": "string",
  "sessionId": "string",
  "userId": "string",
  "role": "citizen | admin"
}
```

### Safe Refusal Response

```json
{
  "answer": "No matching transport policy found. Please contact your nearest RTO.",
  "escalated": true,
  "citations": []
}
```

---

## Knowledge Base Structure

### KB Documents

| KB Doc | Title | Actor | US Coverage | Status |
|---|---|---|---|---|
| **KB-DL-001** | Driving License SOPs & Procedures | Citizen | US-10, US-11, US-12, US-13, US-14 | Active |
| **KB-VR-002** | Vehicle Registration & Transfer | Vehicle Owner | US-15, US-16, US-17, US-18 | Active |
| **KB-TF-003** | Traffic Fines & Challans (RTO-POL-TF-003 v2.0) | Citizen | US-04–US-09, US-21, US-22 | Active |
| **KB-PM-004** | Permits & Commercial Vehicle Rules | Commercial Operator | US-19, US-20 | Active |
| **KB-GR-005** | Grievance Redressal & Citizen Rights | All Citizens | US-30 | Active |

### KB Document Standard

All 5 KB documents are produced as standalone PDFs with consistent structure:
- Cover Page
- Metadata
- Section-by-Section SOPs
- Fee Schedule
- Escalation Guidelines

---

## Document Information

**SRS Version:** 1.0  
**Classification:** Internal | Confidential  
**Powered by:** Spring AI | RAG + Agentic Tool Calling | Azure OpenAI / Ollama / GitHub

---

*For complete details, refer to the full SRS document.*
