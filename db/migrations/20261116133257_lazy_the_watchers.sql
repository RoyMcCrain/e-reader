CREATE TABLE `reading_positions` (
	`user_id` text NOT NULL,
	`book_id` text NOT NULL,
	`cfi` text NOT NULL,
	`revision` integer NOT NULL,
	`mutation_id` text NOT NULL,
	PRIMARY KEY(`user_id`, `book_id`)
);
