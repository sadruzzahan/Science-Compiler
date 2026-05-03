CREATE TABLE "topics" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"slug" text NOT NULL,
	"description" text NOT NULL,
	"domain" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "topics_slug_unique" UNIQUE("slug")
);
--> statement-breakpoint
CREATE TABLE "papers" (
	"id" serial PRIMARY KEY NOT NULL,
	"topic_id" integer NOT NULL,
	"title" text NOT NULL,
	"authors" text NOT NULL,
	"journal" text NOT NULL,
	"publication_year" integer NOT NULL,
	"doi" text,
	"pmid" text,
	"abstract" text NOT NULL,
	"methodology_type" text NOT NULL,
	"sample_size" integer,
	"p_value" text,
	"evidence_quality" text NOT NULL,
	"replication_status" text DEFAULT 'unverified' NOT NULL,
	"open_access_url" text,
	"raw_abstract_xml" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "claims" (
	"id" serial PRIMARY KEY NOT NULL,
	"topic_id" integer NOT NULL,
	"paper_id" integer NOT NULL,
	"claim_text" text NOT NULL,
	"direction" text NOT NULL,
	"effect_size" real,
	"effect_size_unit" text,
	"ci_lower" real,
	"ci_upper" real,
	"population" text NOT NULL,
	"conditions" text,
	"methodology_type" text NOT NULL,
	"evidence_quality" text NOT NULL,
	"replication_status" text DEFAULT 'unverified' NOT NULL,
	"n_replications" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "studies" (
	"id" serial PRIMARY KEY NOT NULL,
	"paper_id" integer NOT NULL,
	"topic_id" integer NOT NULL,
	"title" text NOT NULL,
	"authors" text NOT NULL,
	"publication_year" integer NOT NULL,
	"methodology_type" text NOT NULL,
	"sample_size" integer,
	"effect_size" real,
	"effect_size_unit" text,
	"ci_lower" real,
	"ci_upper" real,
	"p_value" text,
	"evidence_quality" text NOT NULL,
	"population" text NOT NULL,
	"preregistered" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "evidence_links" (
	"id" serial PRIMARY KEY NOT NULL,
	"claim_id" integer NOT NULL,
	"study_id" integer NOT NULL,
	"direction" text NOT NULL,
	"contradiction_explanation" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "claim_synthesis" (
	"id" serial PRIMARY KEY NOT NULL,
	"claim_id" integer NOT NULL,
	"topic_id" integer NOT NULL,
	"consensus_status" text NOT NULL,
	"synthesis_text" text NOT NULL,
	"supporting_count" integer DEFAULT 0 NOT NULL,
	"contradicting_count" integer DEFAULT 0 NOT NULL,
	"weighted_effect_size" real,
	"uncertainty_score" integer DEFAULT 50 NOT NULL,
	"moderating_variables" text,
	"methodological_concerns" text,
	"temporal_trend" text,
	"last_updated" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "claim_synthesis_claim_id_unique" UNIQUE("claim_id")
);
--> statement-breakpoint
CREATE TABLE "ingestion_runs" (
	"id" serial PRIMARY KEY NOT NULL,
	"topic_id" integer,
	"status" text DEFAULT 'pending' NOT NULL,
	"triggered_by" text DEFAULT 'scheduler' NOT NULL,
	"papers_found" integer DEFAULT 0 NOT NULL,
	"papers_processed" integer DEFAULT 0 NOT NULL,
	"claims_extracted" integer DEFAULT 0 NOT NULL,
	"errors_count" integer DEFAULT 0 NOT NULL,
	"error_details" text,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"completed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ingestion_configs" (
	"id" serial PRIMARY KEY NOT NULL,
	"topic_id" integer NOT NULL,
	"pubmed_query" text NOT NULL,
	"max_papers_per_run" integer DEFAULT 10 NOT NULL,
	"enabled" integer DEFAULT 1 NOT NULL,
	"llm_model" text DEFAULT 'gpt-5-mini' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX "evidence_links_claim_study_idx" ON "evidence_links" USING btree ("claim_id","study_id");