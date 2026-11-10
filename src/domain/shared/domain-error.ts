/**
 * A rule of the domain was broken: an object would have become invalid.
 *
 * Thrown while constructing or changing a domain object, which therefore never
 * exists in an invalid state. It signals a bug in the caller or invalid input
 * that the caller should have rejected, not an outcome of normal operation.
 */
export class DomainError extends Error {
  constructor(message: string) {
    super(message);
    this.name = new.target.name;
  }
}
