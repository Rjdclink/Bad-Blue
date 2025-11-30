--
-- PostgreSQL database dump
--

\restrict l993NEAdQTpCFJYLTnVFVXfl9xqkGaTgLgXBTiDknthe1SqfYJitZWi2yWDRsp2

-- Dumped from database version 16.10
-- Dumped by pg_dump version 16.10

SET statement_timeout = 0;
SET lock_timeout = 0;
SET idle_in_transaction_session_timeout = 0;
SET client_encoding = 'UTF8';
SET standard_conforming_strings = on;
SELECT pg_catalog.set_config('search_path', '', false);
SET check_function_bodies = false;
SET xmloption = content;
SET client_min_messages = warning;
SET row_security = off;

SET default_tablespace = '';

SET default_table_access_method = heap;

--
-- Name: ai_cache_entries; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.ai_cache_entries (
    id character varying DEFAULT gen_random_uuid() NOT NULL,
    "cacheKey" character varying(255) NOT NULL,
    "taskName" character varying(100) NOT NULL,
    "taskSignature" text,
    value jsonb NOT NULL,
    "createdAt" timestamp without time zone DEFAULT now() NOT NULL,
    "expiresAt" timestamp without time zone NOT NULL
);


ALTER TABLE public.ai_cache_entries OWNER TO postgres;

--
-- Name: ai_usage_metrics; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.ai_usage_metrics (
    id character varying DEFAULT gen_random_uuid() NOT NULL,
    "timestamp" timestamp without time zone DEFAULT now() NOT NULL,
    "taskName" character varying(100) NOT NULL,
    provider character varying(20) NOT NULL,
    "tokensUsed" integer NOT NULL,
    "latencyMs" integer,
    success boolean NOT NULL,
    verbosity character varying(20) NOT NULL,
    priority integer NOT NULL,
    "errorMessage" text
);


ALTER TABLE public.ai_usage_metrics OWNER TO postgres;

--
-- Name: auth_accounts; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.auth_accounts (
    id character varying DEFAULT gen_random_uuid() NOT NULL,
    user_id character varying NOT NULL,
    auth_type character varying(20) NOT NULL,
    username character varying,
    password_hash text,
    password_salt text,
    last_login_at timestamp without time zone,
    created_at timestamp without time zone DEFAULT now(),
    updated_at timestamp without time zone DEFAULT now()
);


ALTER TABLE public.auth_accounts OWNER TO postgres;

--
-- Name: officer_profiles; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.officer_profiles (
    id character varying DEFAULT gen_random_uuid() NOT NULL,
    officer_name character varying NOT NULL,
    badge_number character varying,
    department character varying,
    rank character varying,
    location character varying,
    career_data jsonb,
    incidents jsonb,
    court_cases jsonb,
    news_mentions jsonb,
    community_complaints jsonb,
    sources text[],
    data_quality_score integer,
    last_verified_at timestamp without time zone,
    metadata jsonb,
    created_at timestamp without time zone DEFAULT now(),
    updated_at timestamp without time zone DEFAULT now()
);


ALTER TABLE public.officer_profiles OWNER TO postgres;

--
-- Name: officer_search_device_limits; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.officer_search_device_limits (
    id character varying DEFAULT gen_random_uuid() NOT NULL,
    device_fingerprint character varying(64) NOT NULL,
    searched_at timestamp without time zone DEFAULT now() NOT NULL,
    ip_address character varying(45),
    user_agent text,
    user_id character varying,
    officer_name character varying
);


ALTER TABLE public.officer_search_device_limits OWNER TO postgres;

--
-- Name: public_evidence; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.public_evidence (
    id text DEFAULT gen_random_uuid() NOT NULL,
    user_id text NOT NULL,
    file_url text NOT NULL,
    file_name text NOT NULL,
    file_type text NOT NULL,
    evidence_category text DEFAULT 'misconduct'::text,
    officer_name text,
    department text,
    location text,
    incident_date timestamp without time zone,
    description text,
    uploaded_at timestamp without time zone DEFAULT now() NOT NULL
);


ALTER TABLE public.public_evidence OWNER TO postgres;

--
-- Name: sessions; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.sessions (
    sid character varying NOT NULL,
    sess jsonb NOT NULL,
    expire timestamp without time zone NOT NULL
);


ALTER TABLE public.sessions OWNER TO postgres;

--
-- Name: users; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.users (
    id character varying DEFAULT gen_random_uuid() NOT NULL,
    email character varying,
    first_name character varying,
    last_name character varying,
    profile_image_url character varying,
    stripe_customer_id character varying,
    has_paid_for_access boolean DEFAULT true NOT NULL,
    access_payment_id character varying,
    access_paid_at timestamp without time zone,
    last_login_at timestamp without time zone,
    password_reset_token text,
    password_reset_token_expiry timestamp without time zone,
    created_at timestamp without time zone DEFAULT now(),
    updated_at timestamp without time zone DEFAULT now()
);


ALTER TABLE public.users OWNER TO postgres;

--
-- Name: worker_alerts; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.worker_alerts (
    id character varying DEFAULT gen_random_uuid() NOT NULL,
    "timestamp" timestamp without time zone DEFAULT now() NOT NULL,
    alert_type character varying NOT NULL,
    severity integer NOT NULL,
    title character varying NOT NULL,
    message text NOT NULL,
    metadata jsonb,
    resolved boolean DEFAULT false NOT NULL,
    resolved_at timestamp without time zone
);


ALTER TABLE public.worker_alerts OWNER TO postgres;

--
-- Name: worker_failure_logs; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.worker_failure_logs (
    id character varying DEFAULT gen_random_uuid() NOT NULL,
    "timestamp" timestamp without time zone DEFAULT now() NOT NULL,
    "functionAffected" character varying(255) NOT NULL,
    cause text NOT NULL,
    "systemState" character varying(20) NOT NULL,
    severity integer NOT NULL,
    priority integer,
    category character varying(50),
    resolved boolean DEFAULT false NOT NULL,
    "resolvedAt" timestamp without time zone,
    metadata jsonb,
    CONSTRAINT worker_failure_logs_priority_check CHECK (((priority >= 1) AND (priority <= 4))),
    CONSTRAINT worker_failure_logs_severity_check CHECK (((severity >= 1) AND (severity <= 5)))
);


ALTER TABLE public.worker_failure_logs OWNER TO postgres;

--
-- Name: worker_function_errors; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.worker_function_errors (
    id character varying DEFAULT gen_random_uuid() NOT NULL,
    "timestamp" timestamp without time zone DEFAULT now() NOT NULL,
    "functionTested" character varying(255) NOT NULL,
    "expectedBehavior" text NOT NULL,
    "observedBehavior" text NOT NULL,
    severity integer NOT NULL,
    status character varying(20) DEFAULT 'pending'::character varying NOT NULL,
    notes text,
    CONSTRAINT worker_function_errors_severity_check CHECK (((severity >= 1) AND (severity <= 5)))
);


ALTER TABLE public.worker_function_errors OWNER TO postgres;

--
-- Name: worker_health_metrics; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.worker_health_metrics (
    id character varying DEFAULT gen_random_uuid() NOT NULL,
    "timestamp" timestamp without time zone DEFAULT now() NOT NULL,
    "checkType" character varying(100) NOT NULL,
    status character varying(20) NOT NULL,
    "consecutiveFailures" integer DEFAULT 0,
    "repairAttempts" integer DEFAULT 0,
    "latencyMs" integer,
    "errorMessage" text,
    metadata jsonb
);


ALTER TABLE public.worker_health_metrics OWNER TO postgres;

--
-- Name: worker_repair_metrics; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.worker_repair_metrics (
    id character varying DEFAULT gen_random_uuid() NOT NULL,
    "timestamp" timestamp without time zone DEFAULT now() NOT NULL,
    "totalRepairs" integer NOT NULL,
    "successfulRepairs" integer NOT NULL,
    "repairSuccessRate" integer NOT NULL,
    "meanResolutionTimeMs" integer,
    "concurrentTaskCount" integer,
    metadata jsonb,
    CONSTRAINT "worker_repair_metrics_repairSuccessRate_check" CHECK ((("repairSuccessRate" >= 0) AND ("repairSuccessRate" <= 100)))
);


ALTER TABLE public.worker_repair_metrics OWNER TO postgres;

--
-- Data for Name: ai_cache_entries; Type: TABLE DATA; Schema: public; Owner: postgres
--

COPY public.ai_cache_entries (id, "cacheKey", "taskName", "taskSignature", value, "createdAt", "expiresAt") FROM stdin;
\.


--
-- Data for Name: ai_usage_metrics; Type: TABLE DATA; Schema: public; Owner: postgres
--

COPY public.ai_usage_metrics (id, "timestamp", "taskName", provider, "tokensUsed", "latencyMs", success, verbosity, priority, "errorMessage") FROM stdin;
\.


--
-- Data for Name: auth_accounts; Type: TABLE DATA; Schema: public; Owner: postgres
--

COPY public.auth_accounts (id, user_id, auth_type, username, password_hash, password_salt, last_login_at, created_at, updated_at) FROM stdin;
\.


--
-- Data for Name: officer_profiles; Type: TABLE DATA; Schema: public; Owner: postgres
--

COPY public.officer_profiles (id, officer_name, badge_number, department, rank, location, career_data, incidents, court_cases, news_mentions, community_complaints, sources, data_quality_score, last_verified_at, metadata, created_at, updated_at) FROM stdin;
\.


--
-- Data for Name: officer_search_device_limits; Type: TABLE DATA; Schema: public; Owner: postgres
--

COPY public.officer_search_device_limits (id, device_fingerprint, searched_at, ip_address, user_agent, user_id, officer_name) FROM stdin;
\.


--
-- Data for Name: public_evidence; Type: TABLE DATA; Schema: public; Owner: postgres
--

COPY public.public_evidence (id, user_id, file_url, file_name, file_type, evidence_category, officer_name, department, location, incident_date, description, uploaded_at) FROM stdin;
\.


--
-- Data for Name: sessions; Type: TABLE DATA; Schema: public; Owner: postgres
--

COPY public.sessions (sid, sess, expire) FROM stdin;
\.


--
-- Data for Name: users; Type: TABLE DATA; Schema: public; Owner: postgres
--

COPY public.users (id, email, first_name, last_name, profile_image_url, stripe_customer_id, has_paid_for_access, access_payment_id, access_paid_at, last_login_at, password_reset_token, password_reset_token_expiry, created_at, updated_at) FROM stdin;
\.


--
-- Data for Name: worker_alerts; Type: TABLE DATA; Schema: public; Owner: postgres
--

COPY public.worker_alerts (id, "timestamp", alert_type, severity, title, message, metadata, resolved, resolved_at) FROM stdin;
\.


--
-- Data for Name: worker_failure_logs; Type: TABLE DATA; Schema: public; Owner: postgres
--

COPY public.worker_failure_logs (id, "timestamp", "functionAffected", cause, "systemState", severity, priority, category, resolved, "resolvedAt", metadata) FROM stdin;
\.


--
-- Data for Name: worker_function_errors; Type: TABLE DATA; Schema: public; Owner: postgres
--

COPY public.worker_function_errors (id, "timestamp", "functionTested", "expectedBehavior", "observedBehavior", severity, status, notes) FROM stdin;
\.


--
-- Data for Name: worker_health_metrics; Type: TABLE DATA; Schema: public; Owner: postgres
--

COPY public.worker_health_metrics (id, "timestamp", "checkType", status, "consecutiveFailures", "repairAttempts", "latencyMs", "errorMessage", metadata) FROM stdin;
\.


--
-- Data for Name: worker_repair_metrics; Type: TABLE DATA; Schema: public; Owner: postgres
--

COPY public.worker_repair_metrics (id, "timestamp", "totalRepairs", "successfulRepairs", "repairSuccessRate", "meanResolutionTimeMs", "concurrentTaskCount", metadata) FROM stdin;
\.


--
-- Name: ai_cache_entries ai_cache_entries_cacheKey_key; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.ai_cache_entries
    ADD CONSTRAINT "ai_cache_entries_cacheKey_key" UNIQUE ("cacheKey");


--
-- Name: ai_cache_entries ai_cache_entries_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.ai_cache_entries
    ADD CONSTRAINT ai_cache_entries_pkey PRIMARY KEY (id);


--
-- Name: ai_usage_metrics ai_usage_metrics_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.ai_usage_metrics
    ADD CONSTRAINT ai_usage_metrics_pkey PRIMARY KEY (id);


--
-- Name: auth_accounts auth_accounts_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.auth_accounts
    ADD CONSTRAINT auth_accounts_pkey PRIMARY KEY (id);


--
-- Name: auth_accounts auth_accounts_username_key; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.auth_accounts
    ADD CONSTRAINT auth_accounts_username_key UNIQUE (username);


--
-- Name: officer_profiles officer_profiles_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.officer_profiles
    ADD CONSTRAINT officer_profiles_pkey PRIMARY KEY (id);


--
-- Name: officer_search_device_limits officer_search_device_limits_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.officer_search_device_limits
    ADD CONSTRAINT officer_search_device_limits_pkey PRIMARY KEY (id);


--
-- Name: public_evidence public_evidence_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.public_evidence
    ADD CONSTRAINT public_evidence_pkey PRIMARY KEY (id);


--
-- Name: sessions sessions_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.sessions
    ADD CONSTRAINT sessions_pkey PRIMARY KEY (sid);


--
-- Name: users users_email_key; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.users
    ADD CONSTRAINT users_email_key UNIQUE (email);


--
-- Name: users users_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.users
    ADD CONSTRAINT users_pkey PRIMARY KEY (id);


--
-- Name: worker_alerts worker_alerts_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.worker_alerts
    ADD CONSTRAINT worker_alerts_pkey PRIMARY KEY (id);


--
-- Name: worker_failure_logs worker_failure_logs_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.worker_failure_logs
    ADD CONSTRAINT worker_failure_logs_pkey PRIMARY KEY (id);


--
-- Name: worker_function_errors worker_function_errors_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.worker_function_errors
    ADD CONSTRAINT worker_function_errors_pkey PRIMARY KEY (id);


--
-- Name: worker_health_metrics worker_health_metrics_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.worker_health_metrics
    ADD CONSTRAINT worker_health_metrics_pkey PRIMARY KEY (id);


--
-- Name: worker_repair_metrics worker_repair_metrics_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.worker_repair_metrics
    ADD CONSTRAINT worker_repair_metrics_pkey PRIMARY KEY (id);


--
-- Name: idx_ai_usage_provider_timestamp; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_ai_usage_provider_timestamp ON public.ai_usage_metrics USING btree (provider, "timestamp" DESC);


--
-- Name: idx_ai_usage_task; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_ai_usage_task ON public.ai_usage_metrics USING btree ("taskName");


--
-- Name: idx_alert_type_resolved; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_alert_type_resolved ON public.worker_alerts USING btree (alert_type, resolved);


--
-- Name: idx_device_fingerprint; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_device_fingerprint ON public.officer_search_device_limits USING btree (device_fingerprint);


--
-- Name: idx_device_fingerprint_date; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_device_fingerprint_date ON public.officer_search_device_limits USING btree (device_fingerprint, searched_at);


--
-- Name: idx_device_time; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_device_time ON public.officer_search_device_limits USING btree (device_fingerprint, searched_at);


--
-- Name: idx_evidence_category; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_evidence_category ON public.public_evidence USING btree (evidence_category);


--
-- Name: idx_evidence_uploaded; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_evidence_uploaded ON public.public_evidence USING btree (uploaded_at DESC);


--
-- Name: idx_evidence_user; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_evidence_user ON public.public_evidence USING btree (user_id);


--
-- Name: idx_failure_category_severity; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_failure_category_severity ON public.worker_failure_logs USING btree (category, severity DESC, "timestamp" DESC);


--
-- Name: idx_failure_timestamp; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_failure_timestamp ON public.worker_failure_logs USING btree ("timestamp");


--
-- Name: idx_failure_unresolved; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_failure_unresolved ON public.worker_failure_logs USING btree (resolved) WHERE (resolved = false);


--
-- Name: idx_func_error_status_severity; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_func_error_status_severity ON public.worker_function_errors USING btree (status, severity DESC);


--
-- Name: idx_func_error_timestamp; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_func_error_timestamp ON public.worker_function_errors USING btree ("timestamp");


--
-- Name: idx_health_check_type; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_health_check_type ON public.worker_health_metrics USING btree ("checkType");


--
-- Name: idx_health_status; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_health_status ON public.worker_health_metrics USING btree (status);


--
-- Name: idx_health_timestamp; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_health_timestamp ON public.worker_health_metrics USING btree ("timestamp");


--
-- Name: idx_repair_metrics_timestamp; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_repair_metrics_timestamp ON public.worker_repair_metrics USING btree ("timestamp");


--
-- Name: idx_searched_at; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_searched_at ON public.officer_search_device_limits USING btree (searched_at);


--
-- Name: idx_session_expire; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_session_expire ON public.sessions USING btree (expire);


--
-- Name: idx_worker_alerts_timestamp; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_worker_alerts_timestamp ON public.worker_alerts USING btree ("timestamp");


--
-- Name: auth_accounts auth_accounts_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.auth_accounts
    ADD CONSTRAINT auth_accounts_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: public_evidence public_evidence_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.public_evidence
    ADD CONSTRAINT public_evidence_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id);


--
-- PostgreSQL database dump complete
--

\unrestrict l993NEAdQTpCFJYLTnVFVXfl9xqkGaTgLgXBTiDknthe1SqfYJitZWi2yWDRsp2

