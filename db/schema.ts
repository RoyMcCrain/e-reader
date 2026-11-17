import { integer, primaryKey, sqliteTable, text } from 'void/schema-d1'

export const readingPositions = sqliteTable(
	'reading_positions',
	{
		userId: text('user_id').notNull(),
		bookId: text('book_id').notNull(),
		cfi: text('cfi').notNull(),
		revision: integer('revision').notNull(),
		mutationId: text('mutation_id').notNull(),
	},
	(table) => [primaryKey({ columns: [table.userId, table.bookId] })],
)
