import type { ValueObject } from './value-object';

/**
 * Base class of every entity: equal by identity, not by its other values.
 *
 * Entities are immutable too. A change returns a new instance with the same id.
 */
export abstract class Entity<Id extends ValueObject> {
  protected constructor(readonly id: Id) {}

  equals(other: unknown): boolean {
    return (
      other instanceof Entity && other.constructor === this.constructor && this.id.equals(other.id)
    );
  }
}
