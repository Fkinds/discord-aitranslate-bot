/**
 * Freeze a newly built domain object and return it with its own type.
 * (Object.freeze returns Readonly<T>, which drops protected members.)
 */
export function frozen<T extends object>(value: T): T {
  Object.freeze(value);
  return value;
}

/**
 * Base class of every value object: immutable and equal by value.
 *
 * Subclasses keep their constructor private, validate in a static factory, and
 * freeze the instance there, so an invalid or changed value cannot exist.
 */
export abstract class ValueObject {
  /** The values that make up this value object, compared in this order. */
  protected abstract equalityComponents(): readonly unknown[];

  equals(other: unknown): boolean {
    if (other === this) return true;
    if (!(other instanceof ValueObject) || other.constructor !== this.constructor) return false;
    const mine = this.equalityComponents();
    const theirs = other.equalityComponents();
    return (
      mine.length === theirs.length &&
      mine.every((value, i) =>
        value instanceof ValueObject ? value.equals(theirs[i]) : Object.is(value, theirs[i])
      )
    );
  }
}
