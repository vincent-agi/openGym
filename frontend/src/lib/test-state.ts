import type { AppState } from './state.ts'

/**
 * A state holding only the fields a test sets, typed as a whole `AppState`.
 *
 * The functions under test read a handful of fields and tolerate the rest being absent (profiles saved by older
 * versions lack newer keys), so tests build the minimal state that exercises one behaviour. Filling in every
 * default instead would change what is being tested. The fields are typed loosely on purpose: a test often
 * writes just the part of a routine or workout that the code under test looks at.
 */
export const partialState = (fields: Record<string, unknown> = {}): AppState => fields as unknown as AppState   // cast: partial by design
