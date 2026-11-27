/** A way of translating to compare: a model, asked as the bot asks it, with or without the glossary. */
export interface Variant {
  readonly model: string;
  readonly glossary: boolean;
}

/** The name a variant goes by in the key: the model's, and "+ glossary" with it. */
export function variantName(variant: Variant): string {
  return variant.glossary ? `${variant.model} + glossary` : variant.model;
}

/**
 * The variants to compare: each model as the bot asks it, and, with a
 * glossary, right after each TranslateGemma model, the same with the
 * glossary; TranslateGemma alone is asked with one.
 */
export function variantsOf(models: readonly string[], withGlossary: boolean): Variant[] {
  return models.flatMap((model) => [
    { model, glossary: false },
    ...(withGlossary && model.startsWith('translategemma') ? [{ model, glossary: true }] : []),
  ]);
}

/** Whether there are translations to tell between, and all of them are the same: then there is nothing to judge. */
export function allTheSame(texts: readonly string[]): boolean {
  return texts.length > 1 && texts.every((text) => text === texts[0]);
}
