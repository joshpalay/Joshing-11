CREATE TABLE "QuestionRating" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" text NOT NULL,
	"question_id" text NOT NULL,
	"rating" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "QuestionRating_user_id_question_id_key" UNIQUE("user_id","question_id")
);
--> statement-breakpoint
ALTER TABLE "QuestionRating" ADD CONSTRAINT "QuestionRating_user_id_User_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."User"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "QuestionRating" ADD CONSTRAINT "QuestionRating_question_id_Question_id_fk" FOREIGN KEY ("question_id") REFERENCES "public"."Question"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
CREATE INDEX "QuestionRating_user_id_idx" ON "QuestionRating" USING btree ("user_id");
--> statement-breakpoint
CREATE INDEX "QuestionRating_question_id_idx" ON "QuestionRating" USING btree ("question_id");
