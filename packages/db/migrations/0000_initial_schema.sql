CREATE TABLE `announcements` (
	`id` text PRIMARY KEY DEFAULT (lower(hex(randomblob(4)) || '-' || hex(randomblob(2)) || '-4' || substr(hex(randomblob(2)), 2) || '-' || substr('89ab', 1 + (abs(random()) % 4), 1) || substr(hex(randomblob(2)), 2) || '-' || hex(randomblob(6)))) NOT NULL,
	`tenant_id` text NOT NULL,
	`title` text NOT NULL,
	`content` text NOT NULL,
	`type` text DEFAULT 'INFO' NOT NULL,
	`target_role` text,
	`is_active` integer DEFAULT true NOT NULL,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL,
	`expires_at` text,
	FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `subscription_invoices` (
	`id` text PRIMARY KEY DEFAULT (lower(hex(randomblob(4)) || '-' || hex(randomblob(2)) || '-4' || substr(hex(randomblob(2)), 2) || '-' || substr('89ab', 1 + (abs(random()) % 4), 1) || substr(hex(randomblob(2)), 2) || '-' || hex(randomblob(6)))) NOT NULL,
	`tenant_id` text NOT NULL,
	`period_start` text NOT NULL,
	`period_end` text NOT NULL,
	`subscription_fee` numeric NOT NULL,
	`transaction_fees` numeric NOT NULL,
	`total_amount` numeric NOT NULL,
	`currency` text NOT NULL,
	`status` text DEFAULT 'DRAFT' NOT NULL,
	`paid_at` text,
	`payment_ref` text,
	`line_items` text NOT NULL,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL,
	`updated_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL,
	FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `tenant_api_keys` (
	`id` text PRIMARY KEY DEFAULT (lower(hex(randomblob(4)) || '-' || hex(randomblob(2)) || '-4' || substr(hex(randomblob(2)), 2) || '-' || substr('89ab', 1 + (abs(random()) % 4), 1) || substr(hex(randomblob(2)), 2) || '-' || hex(randomblob(6)))) NOT NULL,
	`tenant_id` text NOT NULL,
	`name` text NOT NULL,
	`key_hash` text NOT NULL,
	`key_prefix` text NOT NULL,
	`scopes` text DEFAULT '[]' NOT NULL,
	`is_active` integer DEFAULT true NOT NULL,
	`last_used_at` text,
	`expires_at` text,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL,
	`revoked_at` text,
	`revoked_by_id` text,
	FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `tenant_api_keys_hash_idx` ON `tenant_api_keys` (`key_hash`);--> statement-breakpoint
CREATE TABLE `tenants` (
	`id` text PRIMARY KEY DEFAULT (lower(hex(randomblob(4)) || '-' || hex(randomblob(2)) || '-4' || substr(hex(randomblob(2)), 2) || '-' || substr('89ab', 1 + (abs(random()) % 4), 1) || substr(hex(randomblob(2)), 2) || '-' || hex(randomblob(6)))) NOT NULL,
	`name` text NOT NULL,
	`slug` text NOT NULL,
	`custom_domain` text,
	`parent_tenant_id` text,
	`status` text DEFAULT 'ONBOARDING' NOT NULL,
	`plan` text DEFAULT 'TRIAL' NOT NULL,
	`region` text DEFAULT 'INDIA' NOT NULL,
	`default_currency` text DEFAULT 'INR' NOT NULL,
	`default_language` text DEFAULT 'en' NOT NULL,
	`logo_url` text,
	`favicon_url` text,
	`primary_color` text DEFAULT '#E31E24' NOT NULL,
	`secondary_color` text DEFAULT '#F7941D' NOT NULL,
	`accent_color` text DEFAULT '#F5C518' NOT NULL,
	`font_family` text DEFAULT 'Inter' NOT NULL,
	`company_name` text,
	`tagline` text,
	`show_powered_by` integer DEFAULT true NOT NULL,
	`support_email` text,
	`support_phone` text,
	`support_whatsapp` text,
	`email_sender_name` text,
	`whatsapp_sender_id` text,
	`home_banner_config` text,
	`footer_config` text,
	`homepage_routes` text,
	`gst_number` text,
	`vat_number` text,
	`iata_code` text,
	`address` text,
	`terms_url` text,
	`privacy_url` text,
	`allow_b2c` integer DEFAULT true NOT NULL,
	`allow_b2b` integer DEFAULT true NOT NULL,
	`allow_whatsapp` integer DEFAULT false NOT NULL,
	`allow_group_booking` integer DEFAULT false NOT NULL,
	`allow_seat_selection` integer DEFAULT false NOT NULL,
	`search_rpm_limit` integer DEFAULT 60 NOT NULL,
	`booking_rpm_limit` integer DEFAULT 20 NOT NULL,
	`payment_config` text,
	`subscription_fee` numeric DEFAULT '0' NOT NULL,
	`per_booking_fee` numeric DEFAULT '0' NOT NULL,
	`per_booking_fee_type` text DEFAULT 'PERCENTAGE' NOT NULL,
	`billing_cycle_day` integer DEFAULT 1 NOT NULL,
	`trial_ends_at` text,
	`subscription_ends_at` text,
	`usage_current_month` text,
	`usage_reset_at` text,
	`onboarding_step` integer DEFAULT 0 NOT NULL,
	`is_setup_complete` integer DEFAULT false NOT NULL,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL,
	`updated_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `tenants_slug_idx` ON `tenants` (`slug`);--> statement-breakpoint
CREATE UNIQUE INDEX `tenants_custom_domain_idx` ON `tenants` (`custom_domain`);--> statement-breakpoint
CREATE TABLE `webhook_configs` (
	`id` text PRIMARY KEY DEFAULT (lower(hex(randomblob(4)) || '-' || hex(randomblob(2)) || '-4' || substr(hex(randomblob(2)), 2) || '-' || substr('89ab', 1 + (abs(random()) % 4), 1) || substr(hex(randomblob(2)), 2) || '-' || hex(randomblob(6)))) NOT NULL,
	`tenant_id` text NOT NULL,
	`name` text NOT NULL,
	`url` text NOT NULL,
	`secret` text,
	`events` text DEFAULT '[]' NOT NULL,
	`is_active` integer DEFAULT true NOT NULL,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL,
	`updated_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL,
	FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `saved_passengers` (
	`id` text PRIMARY KEY DEFAULT (lower(hex(randomblob(4)) || '-' || hex(randomblob(2)) || '-4' || substr(hex(randomblob(2)), 2) || '-' || substr('89ab', 1 + (abs(random()) % 4), 1) || substr(hex(randomblob(2)), 2) || '-' || hex(randomblob(6)))) NOT NULL,
	`user_id` text NOT NULL,
	`first_name` text NOT NULL,
	`last_name` text NOT NULL,
	`dob` text,
	`gender` text,
	`nationality` text,
	`passport_number` text,
	`passport_expiry` text,
	`passport_country` text,
	`is_default` integer DEFAULT false NOT NULL,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL,
	`updated_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `social_auth_challenges` (
	`id` text PRIMARY KEY NOT NULL,
	`tenant_id` text NOT NULL,
	`provider` text NOT NULL,
	`nonce` text NOT NULL,
	`proof_hash` text NOT NULL,
	`expires_at` text NOT NULL,
	FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `user_sessions` (
	`id` text PRIMARY KEY DEFAULT (lower(hex(randomblob(4)) || '-' || hex(randomblob(2)) || '-4' || substr(hex(randomblob(2)), 2) || '-' || substr('89ab', 1 + (abs(random()) % 4), 1) || substr(hex(randomblob(2)), 2) || '-' || hex(randomblob(6)))) NOT NULL,
	`user_id` text NOT NULL,
	`token` text NOT NULL,
	`expires_at` text NOT NULL,
	`ip_address` text,
	`user_agent` text,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `user_sessions_token_idx` ON `user_sessions` (`token`);--> statement-breakpoint
CREATE TABLE `users` (
	`id` text PRIMARY KEY DEFAULT (lower(hex(randomblob(4)) || '-' || hex(randomblob(2)) || '-4' || substr(hex(randomblob(2)), 2) || '-' || substr('89ab', 1 + (abs(random()) % 4), 1) || substr(hex(randomblob(2)), 2) || '-' || hex(randomblob(6)))) NOT NULL,
	`tenant_id` text NOT NULL,
	`email` text,
	`phone` text,
	`name` text,
	`password_hash` text,
	`social_provider` text,
	`social_subject` text,
	`role` text DEFAULT 'CUSTOMER' NOT NULL,
	`is_active` integer DEFAULT true NOT NULL,
	`agent_id` text,
	`admin_permissions` text DEFAULT '[]' NOT NULL,
	`email_verified` integer DEFAULT false NOT NULL,
	`phone_verified` integer DEFAULT false NOT NULL,
	`two_factor_enabled` integer DEFAULT false NOT NULL,
	`two_factor_secret` text,
	`preferred_currency` text,
	`preferred_language` text,
	`whatsapp_opt_in` integer DEFAULT false NOT NULL,
	`last_login_at` text,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL,
	`updated_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL,
	FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `users_tenant_email_idx` ON `users` (`tenant_id`,`email`);--> statement-breakpoint
CREATE UNIQUE INDEX `users_tenant_phone_idx` ON `users` (`tenant_id`,`phone`);--> statement-breakpoint
CREATE UNIQUE INDEX `users_tenant_social_idx` ON `users` (`tenant_id`,`social_provider`,`social_subject`);--> statement-breakpoint
CREATE TABLE `agent_activity_daily` (
	`agent_id` text NOT NULL,
	`day` text NOT NULL,
	`tenant_id` text NOT NULL,
	`searches` integer DEFAULT 0 NOT NULL,
	`checkouts` integer DEFAULT 0 NOT NULL,
	PRIMARY KEY(`agent_id`, `day`),
	FOREIGN KEY (`agent_id`) REFERENCES `agents`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `agent_activity_daily_tenant_idx` ON `agent_activity_daily` (`tenant_id`,`day`);--> statement-breakpoint
CREATE TABLE `agent_documents` (
	`id` text PRIMARY KEY DEFAULT (lower(hex(randomblob(4)) || '-' || hex(randomblob(2)) || '-4' || substr(hex(randomblob(2)), 2) || '-' || substr('89ab', 1 + (abs(random()) % 4), 1) || substr(hex(randomblob(2)), 2) || '-' || hex(randomblob(6)))) NOT NULL,
	`agent_id` text NOT NULL,
	`doc_type` text NOT NULL,
	`file_url` text NOT NULL,
	`file_name` text NOT NULL,
	`mime_type` text,
	`uploaded_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL,
	`verified_at` text,
	`verified_by_id` text,
	FOREIGN KEY (`agent_id`) REFERENCES `agents`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `agent_quotes` (
	`id` text PRIMARY KEY DEFAULT (lower(hex(randomblob(4)) || '-' || hex(randomblob(2)) || '-4' || substr(hex(randomblob(2)), 2) || '-' || substr('89ab', 1 + (abs(random()) % 4), 1) || substr(hex(randomblob(2)), 2) || '-' || hex(randomblob(6)))) NOT NULL,
	`tenant_id` text NOT NULL,
	`agent_id` text NOT NULL,
	`user_id` text,
	`token` text NOT NULL,
	`customer_name` text,
	`customer_phone` text,
	`options` text DEFAULT '[]' NOT NULL,
	`note` text,
	`currency` text DEFAULT 'INR' NOT NULL,
	`expires_at` text NOT NULL,
	`viewed_at` text,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL,
	FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`agent_id`) REFERENCES `agents`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `agent_quotes_token_unique` ON `agent_quotes` (`token`);--> statement-breakpoint
CREATE TABLE `agent_request_messages` (
	`id` text PRIMARY KEY DEFAULT (lower(hex(randomblob(4)) || '-' || hex(randomblob(2)) || '-4' || substr(hex(randomblob(2)), 2) || '-' || substr('89ab', 1 + (abs(random()) % 4), 1) || substr(hex(randomblob(2)), 2) || '-' || hex(randomblob(6)))) NOT NULL,
	`request_id` text NOT NULL,
	`user_id` text,
	`from_staff` integer DEFAULT false NOT NULL,
	`message` text NOT NULL,
	`attachments` text DEFAULT '[]' NOT NULL,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL,
	FOREIGN KEY (`request_id`) REFERENCES `agent_requests`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `agent_requests` (
	`id` text PRIMARY KEY DEFAULT (lower(hex(randomblob(4)) || '-' || hex(randomblob(2)) || '-4' || substr(hex(randomblob(2)), 2) || '-' || substr('89ab', 1 + (abs(random()) % 4), 1) || substr(hex(randomblob(2)), 2) || '-' || hex(randomblob(6)))) NOT NULL,
	`tenant_id` text NOT NULL,
	`agent_id` text NOT NULL,
	`user_id` text,
	`booking_id` text,
	`type` text NOT NULL,
	`status` text DEFAULT 'OPEN' NOT NULL,
	`title` text NOT NULL,
	`details` text DEFAULT '{}' NOT NULL,
	`attachments` text DEFAULT '[]' NOT NULL,
	`amount` numeric,
	`currency` text,
	`admin_note` text,
	`due_at` text,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL,
	`updated_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL,
	FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`agent_id`) REFERENCES `agents`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `agent_requests_agent_idx` ON `agent_requests` (`agent_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `agent_requests_tenant_status_idx` ON `agent_requests` (`tenant_id`,`status`,`type`,`created_at`);--> statement-breakpoint
CREATE TABLE `agent_travellers` (
	`id` text PRIMARY KEY DEFAULT (lower(hex(randomblob(4)) || '-' || hex(randomblob(2)) || '-4' || substr(hex(randomblob(2)), 2) || '-' || substr('89ab', 1 + (abs(random()) % 4), 1) || substr(hex(randomblob(2)), 2) || '-' || hex(randomblob(6)))) NOT NULL,
	`agent_id` text NOT NULL,
	`type` text DEFAULT 'ADULT' NOT NULL,
	`first_name` text NOT NULL,
	`last_name` text NOT NULL,
	`dob` text,
	`gender` text,
	`nationality` text,
	`passport_number` text,
	`passport_expiry` text,
	`phone` text,
	`email` text,
	`group_name` text,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL,
	`updated_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL,
	FOREIGN KEY (`agent_id`) REFERENCES `agents`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `agents` (
	`id` text PRIMARY KEY DEFAULT (lower(hex(randomblob(4)) || '-' || hex(randomblob(2)) || '-4' || substr(hex(randomblob(2)), 2) || '-' || substr('89ab', 1 + (abs(random()) % 4), 1) || substr(hex(randomblob(2)), 2) || '-' || hex(randomblob(6)))) NOT NULL,
	`tenant_id` text NOT NULL,
	`business_name` text NOT NULL,
	`owner_name` text NOT NULL,
	`email` text NOT NULL,
	`phone` text NOT NULL,
	`whatsapp` text,
	`region` text NOT NULL,
	`currency` text NOT NULL,
	`status` text DEFAULT 'PENDING' NOT NULL,
	`iata_code` text,
	`agent_number` text,
	`parent_agent_id` text,
	`credit_limit` numeric DEFAULT '0' NOT NULL,
	`minimum_deposit` numeric DEFAULT '0' NOT NULL,
	`settings` text DEFAULT '{}' NOT NULL,
	`approved_at` text,
	`approved_by_id` text,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL,
	`updated_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL,
	FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `agents_tenant_email_idx` ON `agents` (`tenant_id`,`email`);--> statement-breakpoint
CREATE INDEX `agents_tenant_status_idx` ON `agents` (`tenant_id`,`status`);--> statement-breakpoint
CREATE UNIQUE INDEX `agents_tenant_number_idx` ON `agents` (`tenant_id`,`agent_number`);--> statement-breakpoint
CREATE TABLE `booking_amendments` (
	`id` text PRIMARY KEY DEFAULT (lower(hex(randomblob(4)) || '-' || hex(randomblob(2)) || '-4' || substr(hex(randomblob(2)), 2) || '-' || substr('89ab', 1 + (abs(random()) % 4), 1) || substr(hex(randomblob(2)), 2) || '-' || hex(randomblob(6)))) NOT NULL,
	`tenant_id` text NOT NULL,
	`booking_id` text NOT NULL,
	`user_id` text,
	`type` text DEFAULT 'CANCELLATION' NOT NULL,
	`status` text DEFAULT 'SUBMITTED' NOT NULL,
	`supplier` text DEFAULT 'TRIPJACK' NOT NULL,
	`supplier_amendment_id` text,
	`supplier_status` text,
	`amount_paid` numeric NOT NULL,
	`supplier_charges` numeric,
	`refund_amount` numeric,
	`currency` text NOT NULL,
	`refund_method` text DEFAULT 'WALLET' NOT NULL,
	`refund_status` text DEFAULT 'PENDING' NOT NULL,
	`refund_reference` text,
	`refund_error` text,
	`refunded_at` text,
	`quote` text,
	`last_supplier_response` text,
	`admin_note` text,
	`last_checked_at` text,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL,
	`updated_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL,
	FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`booking_id`) REFERENCES `bookings`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `booking_amendments_one_active_cancel_idx` ON `booking_amendments` (`booking_id`) WHERE type = 'CANCELLATION' AND status IN ('SUBMITTED', 'PROCESSING', 'SUCCESS');--> statement-breakpoint
CREATE TABLE `booking_passengers` (
	`id` text PRIMARY KEY DEFAULT (lower(hex(randomblob(4)) || '-' || hex(randomblob(2)) || '-4' || substr(hex(randomblob(2)), 2) || '-' || substr('89ab', 1 + (abs(random()) % 4), 1) || substr(hex(randomblob(2)), 2) || '-' || hex(randomblob(6)))) NOT NULL,
	`booking_id` text NOT NULL,
	`passenger_type` text NOT NULL,
	`title` text,
	`first_name` text NOT NULL,
	`last_name` text NOT NULL,
	`dob` text,
	`gender` text,
	`nationality` text,
	`passport_number` text,
	`passport_expiry` text,
	`passport_country` text,
	`ticket_number` text,
	`seat_number` text,
	`meal_code` text,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL,
	FOREIGN KEY (`booking_id`) REFERENCES `bookings`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `bookings` (
	`id` text PRIMARY KEY DEFAULT (lower(hex(randomblob(4)) || '-' || hex(randomblob(2)) || '-4' || substr(hex(randomblob(2)), 2) || '-' || substr('89ab', 1 + (abs(random()) % 4), 1) || substr(hex(randomblob(2)), 2) || '-' || hex(randomblob(6)))) NOT NULL,
	`tenant_id` text NOT NULL,
	`user_id` text,
	`agent_id` text,
	`channel` text NOT NULL,
	`status` text DEFAULT 'SEARCHED' NOT NULL,
	`trip_type` text NOT NULL,
	`cabin_class` text DEFAULT 'ECONOMY' NOT NULL,
	`origin` text NOT NULL,
	`destination` text NOT NULL,
	`departure_date` text NOT NULL,
	`return_date` text,
	`flight_data` text NOT NULL,
	`adult_count` integer DEFAULT 1 NOT NULL,
	`child_count` integer DEFAULT 0 NOT NULL,
	`infant_count` integer DEFAULT 0 NOT NULL,
	`base_fare` numeric NOT NULL,
	`taxes` numeric NOT NULL,
	`markup` numeric DEFAULT '0' NOT NULL,
	`convenience_fee` numeric DEFAULT '0' NOT NULL,
	`promo_discount` numeric DEFAULT '0' NOT NULL,
	`platform_fee` numeric DEFAULT '0' NOT NULL,
	`total_amount` numeric NOT NULL,
	`currency` text NOT NULL,
	`supplier` text NOT NULL,
	`supplier_booking_ref` text,
	`supplier_session_id` text,
	`pnr` text,
	`ticket_numbers` text DEFAULT '[]' NOT NULL,
	`gst_applicable` integer DEFAULT false NOT NULL,
	`gst_number` text,
	`gst_details` text,
	`add_ons` text,
	`promo_code_id` text,
	`held_until` text,
	`group_ref` text,
	`contact_email` text,
	`contact_phone` text,
	`ip_address` text,
	`user_agent` text,
	`whatsapp_phone` text,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL,
	`updated_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL,
	`wallet_bonus_credited_at` text,
	FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`agent_id`) REFERENCES `agents`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `bookings_tenant_status_idx` ON `bookings` (`tenant_id`,`status`);--> statement-breakpoint
CREATE INDEX `bookings_tenant_agent_idx` ON `bookings` (`tenant_id`,`agent_id`);--> statement-breakpoint
CREATE INDEX `bookings_pnr_idx` ON `bookings` (`pnr`);--> statement-breakpoint
CREATE INDEX `bookings_group_ref_idx` ON `bookings` (`group_ref`);--> statement-breakpoint
CREATE TABLE `cancellation_requests` (
	`id` text PRIMARY KEY DEFAULT (lower(hex(randomblob(4)) || '-' || hex(randomblob(2)) || '-4' || substr(hex(randomblob(2)), 2) || '-' || substr('89ab', 1 + (abs(random()) % 4), 1) || substr(hex(randomblob(2)), 2) || '-' || hex(randomblob(6)))) NOT NULL,
	`booking_id` text NOT NULL,
	`reason` text,
	`requested_by_id` text,
	`status` text DEFAULT 'PENDING' NOT NULL,
	`supplier_penalty` numeric,
	`tenant_penalty` numeric,
	`refund_amount` numeric,
	`requested_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL,
	`processed_at` text,
	`processed_by_id` text,
	`notes` text,
	FOREIGN KEY (`booking_id`) REFERENCES `bookings`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `reissue_requests` (
	`id` text PRIMARY KEY DEFAULT (lower(hex(randomblob(4)) || '-' || hex(randomblob(2)) || '-4' || substr(hex(randomblob(2)), 2) || '-' || substr('89ab', 1 + (abs(random()) % 4), 1) || substr(hex(randomblob(2)), 2) || '-' || hex(randomblob(6)))) NOT NULL,
	`booking_id` text NOT NULL,
	`new_departure_date` text,
	`new_return_date` text,
	`new_origin` text,
	`new_destination` text,
	`reason` text,
	`requested_by_id` text,
	`status` text DEFAULT 'PENDING' NOT NULL,
	`date_diff_fare` numeric,
	`supplier_penalty` numeric,
	`tenant_penalty` numeric,
	`total_due` numeric,
	`requested_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL,
	`processed_at` text,
	`processed_by_id` text,
	FOREIGN KEY (`booking_id`) REFERENCES `bookings`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `support_requests` (
	`id` text PRIMARY KEY DEFAULT (lower(hex(randomblob(4)) || '-' || hex(randomblob(2)) || '-4' || substr(hex(randomblob(2)), 2) || '-' || substr('89ab', 1 + (abs(random()) % 4), 1) || substr(hex(randomblob(2)), 2) || '-' || hex(randomblob(6)))) NOT NULL,
	`tenant_id` text NOT NULL,
	`user_id` text,
	`booking_id` text,
	`type` text NOT NULL,
	`message` text NOT NULL,
	`contact_email` text,
	`contact_phone` text,
	`status` text DEFAULT 'OPEN' NOT NULL,
	`admin_note` text,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL,
	`updated_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL,
	FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`booking_id`) REFERENCES `bookings`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE TABLE `commissions` (
	`id` text PRIMARY KEY DEFAULT (lower(hex(randomblob(4)) || '-' || hex(randomblob(2)) || '-4' || substr(hex(randomblob(2)), 2) || '-' || substr('89ab', 1 + (abs(random()) % 4), 1) || substr(hex(randomblob(2)), 2) || '-' || hex(randomblob(6)))) NOT NULL,
	`booking_id` text NOT NULL,
	`agent_id` text NOT NULL,
	`base_amount` numeric NOT NULL,
	`rate_percent` numeric NOT NULL,
	`amount` numeric NOT NULL,
	`currency` text NOT NULL,
	`paid_at` text,
	`paid_via` text,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL,
	FOREIGN KEY (`booking_id`) REFERENCES `bookings`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`agent_id`) REFERENCES `agents`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `commissions_booking_id_idx` ON `commissions` (`booking_id`);--> statement-breakpoint
CREATE TABLE `payments` (
	`id` text PRIMARY KEY DEFAULT (lower(hex(randomblob(4)) || '-' || hex(randomblob(2)) || '-4' || substr(hex(randomblob(2)), 2) || '-' || substr('89ab', 1 + (abs(random()) % 4), 1) || substr(hex(randomblob(2)), 2) || '-' || hex(randomblob(6)))) NOT NULL,
	`booking_id` text NOT NULL,
	`gateway` text NOT NULL,
	`gateway_order_id` text,
	`gateway_payment_id` text,
	`amount` numeric NOT NULL,
	`currency` text NOT NULL,
	`status` text DEFAULT 'PENDING' NOT NULL,
	`payment_method` text,
	`gateway_response` text,
	`refunded_amount` numeric,
	`refund_initiated_at` text,
	`refund_completed_at` text,
	`refund_gateway_ref` text,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL,
	`updated_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL,
	FOREIGN KEY (`booking_id`) REFERENCES `bookings`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `payments_gateway_payment_id_idx` ON `payments` (`gateway_payment_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `payments_wallet_booking_idx` ON `payments` (`booking_id`) WHERE gateway = 'WALLET';--> statement-breakpoint
CREATE TABLE `wallet_accounts` (
	`id` text PRIMARY KEY DEFAULT (lower(hex(randomblob(4)) || '-' || hex(randomblob(2)) || '-4' || substr(hex(randomblob(2)), 2) || '-' || substr('89ab', 1 + (abs(random()) % 4), 1) || substr(hex(randomblob(2)), 2) || '-' || hex(randomblob(6)))) NOT NULL,
	`tenant_id` text NOT NULL,
	`agent_id` text,
	`user_id` text,
	`currency` text NOT NULL,
	`balance` numeric DEFAULT '0' NOT NULL,
	`credit_limit` numeric DEFAULT '0' NOT NULL,
	`alert_threshold` numeric,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL,
	`updated_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL,
	FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`agent_id`) REFERENCES `agents`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `wallet_accounts_agent_id_idx` ON `wallet_accounts` (`agent_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `wallet_accounts_user_id_idx` ON `wallet_accounts` (`user_id`);--> statement-breakpoint
CREATE TABLE `wallet_coupons` (
	`id` text PRIMARY KEY DEFAULT (lower(hex(randomblob(4)) || '-' || hex(randomblob(2)) || '-4' || substr(hex(randomblob(2)), 2) || '-' || substr('89ab', 1 + (abs(random()) % 4), 1) || substr(hex(randomblob(2)), 2) || '-' || hex(randomblob(6)))) NOT NULL,
	`tenant_id` text NOT NULL,
	`code` text NOT NULL,
	`amount` numeric NOT NULL,
	`currency` text NOT NULL,
	`created_by_user_id` text NOT NULL,
	`wallet_account_id` text NOT NULL,
	`status` text DEFAULT 'ACTIVE' NOT NULL,
	`redeemed_by_user_id` text,
	`redeemed_at` text,
	`expires_at` text NOT NULL,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL,
	FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`created_by_user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`wallet_account_id`) REFERENCES `wallet_accounts`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`redeemed_by_user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `wallet_coupons_tenant_code_idx` ON `wallet_coupons` (`tenant_id`,`code`);--> statement-breakpoint
CREATE TABLE `wallet_transactions` (
	`id` text PRIMARY KEY DEFAULT (lower(hex(randomblob(4)) || '-' || hex(randomblob(2)) || '-4' || substr(hex(randomblob(2)), 2) || '-' || substr('89ab', 1 + (abs(random()) % 4), 1) || substr(hex(randomblob(2)), 2) || '-' || hex(randomblob(6)))) NOT NULL,
	`wallet_account_id` text NOT NULL,
	`type` text NOT NULL,
	`amount` numeric NOT NULL,
	`balance_before` numeric NOT NULL,
	`balance_after` numeric NOT NULL,
	`booking_id` text,
	`payment_id` text,
	`note` text,
	`performed_by_id` text,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL,
	FOREIGN KEY (`wallet_account_id`) REFERENCES `wallet_accounts`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `leadvyne_configs` (
	`id` text PRIMARY KEY DEFAULT (lower(hex(randomblob(4)) || '-' || hex(randomblob(2)) || '-4' || substr(hex(randomblob(2)), 2) || '-' || substr('89ab', 1 + (abs(random()) % 4), 1) || substr(hex(randomblob(2)), 2) || '-' || hex(randomblob(6)))) NOT NULL,
	`tenant_id` text NOT NULL,
	`environment` text DEFAULT 'production' NOT NULL,
	`chatwoot_base_url` text,
	`chatwoot_inbox_id` integer,
	`chatwoot_api_token` text,
	`whatsapp_number` text,
	`endpoint_mappings` text NOT NULL,
	`timeout_ms` integer DEFAULT 15000 NOT NULL,
	`retry_count` integer DEFAULT 2 NOT NULL,
	`webhook_url` text,
	`webhook_secret` text,
	`template_mappings` text,
	`show_serp_disclaimer` integer DEFAULT true NOT NULL,
	`is_active` integer DEFAULT true NOT NULL,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL,
	`updated_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL,
	FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `leadvyne_configs_tenant_env_idx` ON `leadvyne_configs` (`tenant_id`,`environment`);--> statement-breakpoint
CREATE TABLE `markup_rules` (
	`id` text PRIMARY KEY DEFAULT (lower(hex(randomblob(4)) || '-' || hex(randomblob(2)) || '-4' || substr(hex(randomblob(2)), 2) || '-' || substr('89ab', 1 + (abs(random()) % 4), 1) || substr(hex(randomblob(2)), 2) || '-' || hex(randomblob(6)))) NOT NULL,
	`tenant_id` text NOT NULL,
	`agent_id` text,
	`name` text NOT NULL,
	`is_default` integer DEFAULT false NOT NULL,
	`airline` text,
	`origin` text,
	`destination` text,
	`cabin_class` text,
	`supplier` text,
	`trip_type` text,
	`markup_type` text NOT NULL,
	`markup_value` numeric NOT NULL,
	`valid_from` text,
	`valid_to` text,
	`is_active` integer DEFAULT true NOT NULL,
	`priority` integer DEFAULT 0 NOT NULL,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL,
	`updated_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL,
	FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`agent_id`) REFERENCES `agents`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `promo_codes` (
	`id` text PRIMARY KEY DEFAULT (lower(hex(randomblob(4)) || '-' || hex(randomblob(2)) || '-4' || substr(hex(randomblob(2)), 2) || '-' || substr('89ab', 1 + (abs(random()) % 4), 1) || substr(hex(randomblob(2)), 2) || '-' || hex(randomblob(6)))) NOT NULL,
	`tenant_id` text NOT NULL,
	`code` text NOT NULL,
	`description` text,
	`discount_type` text NOT NULL,
	`discount_value` numeric NOT NULL,
	`max_discount` numeric,
	`min_fare_amount` numeric,
	`usage_limit` integer,
	`usage_count` integer DEFAULT 0 NOT NULL,
	`per_user_limit` integer DEFAULT 1 NOT NULL,
	`applicable_on` text DEFAULT '[]' NOT NULL,
	`airlines` text DEFAULT '[]' NOT NULL,
	`routes` text DEFAULT '[]' NOT NULL,
	`valid_from` text NOT NULL,
	`valid_to` text NOT NULL,
	`is_active` integer DEFAULT true NOT NULL,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL,
	FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `promo_codes_tenant_code_idx` ON `promo_codes` (`tenant_id`,`code`);--> statement-breakpoint
CREATE TABLE `supplier_api_logs` (
	`id` text PRIMARY KEY DEFAULT (lower(hex(randomblob(4)) || '-' || hex(randomblob(2)) || '-4' || substr(hex(randomblob(2)), 2) || '-' || substr('89ab', 1 + (abs(random()) % 4), 1) || substr(hex(randomblob(2)), 2) || '-' || hex(randomblob(6)))) NOT NULL,
	`tenant_id` text NOT NULL,
	`supplier` text NOT NULL,
	`endpoint` text NOT NULL,
	`http_status` integer,
	`level` text DEFAULT 'INFO' NOT NULL,
	`request_id` text,
	`request_summary` text,
	`response_snippet` text,
	`error_code` text,
	`error_message` text,
	`duration_ms` integer,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL,
	FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `supplier_api_logs_tenant_time_idx` ON `supplier_api_logs` (`tenant_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `supplier_api_logs_level_idx` ON `supplier_api_logs` (`tenant_id`,`level`,`created_at`);--> statement-breakpoint
CREATE TABLE `supplier_exchanges` (
	`id` text PRIMARY KEY DEFAULT (lower(hex(randomblob(4)) || '-' || hex(randomblob(2)) || '-4' || substr(hex(randomblob(2)), 2) || '-' || substr('89ab', 1 + (abs(random()) % 4), 1) || substr(hex(randomblob(2)), 2) || '-' || hex(randomblob(6)))) NOT NULL,
	`tenant_id` text NOT NULL,
	`booking_id` text,
	`search_id` text,
	`request_id` text,
	`supplier` text NOT NULL,
	`endpoint` text NOT NULL,
	`url` text NOT NULL,
	`http_status` integer,
	`duration_ms` integer,
	`error` text,
	`request_key` text NOT NULL,
	`response_key` text,
	`started_at` text NOT NULL,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL,
	FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `tenant_supplier_configs` (
	`id` text PRIMARY KEY DEFAULT (lower(hex(randomblob(4)) || '-' || hex(randomblob(2)) || '-4' || substr(hex(randomblob(2)), 2) || '-' || substr('89ab', 1 + (abs(random()) % 4), 1) || substr(hex(randomblob(2)), 2) || '-' || hex(randomblob(6)))) NOT NULL,
	`tenant_id` text NOT NULL,
	`supplier` text NOT NULL,
	`is_enabled` integer DEFAULT true NOT NULL,
	`priority` integer DEFAULT 1 NOT NULL,
	`credentials` text,
	`timeout_ms` integer DEFAULT 15000 NOT NULL,
	`max_retries` integer DEFAULT 2 NOT NULL,
	`calls_this_month` integer DEFAULT 0 NOT NULL,
	`calls_limit` integer,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL,
	`updated_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL,
	FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `tenant_supplier_configs_idx` ON `tenant_supplier_configs` (`tenant_id`,`supplier`);--> statement-breakpoint
CREATE TABLE `audit_logs` (
	`id` text PRIMARY KEY DEFAULT (lower(hex(randomblob(4)) || '-' || hex(randomblob(2)) || '-4' || substr(hex(randomblob(2)), 2) || '-' || substr('89ab', 1 + (abs(random()) % 4), 1) || substr(hex(randomblob(2)), 2) || '-' || hex(randomblob(6)))) NOT NULL,
	`tenant_id` text NOT NULL,
	`user_id` text,
	`action` text NOT NULL,
	`entity` text NOT NULL,
	`entity_id` text,
	`before` text,
	`after` text,
	`ip_address` text,
	`user_agent` text,
	`metadata` text,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL,
	FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `audit_logs_entity_idx` ON `audit_logs` (`tenant_id`,`entity`,`entity_id`);--> statement-breakpoint
CREATE INDEX `audit_logs_user_idx` ON `audit_logs` (`tenant_id`,`user_id`);--> statement-breakpoint
CREATE INDEX `audit_logs_time_idx` ON `audit_logs` (`tenant_id`,`created_at`);--> statement-breakpoint
CREATE TABLE `email_logs` (
	`id` text PRIMARY KEY DEFAULT (lower(hex(randomblob(4)) || '-' || hex(randomblob(2)) || '-4' || substr(hex(randomblob(2)), 2) || '-' || substr('89ab', 1 + (abs(random()) % 4), 1) || substr(hex(randomblob(2)), 2) || '-' || hex(randomblob(6)))) NOT NULL,
	`tenant_id` text,
	`to_email` text NOT NULL,
	`subject` text NOT NULL,
	`category` text NOT NULL,
	`status` text NOT NULL,
	`provider_id` text,
	`error` text,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL,
	FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `email_logs_tenant_idx` ON `email_logs` (`tenant_id`,`created_at`);