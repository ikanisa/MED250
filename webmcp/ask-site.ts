import { defineTool } from "@nekuda/webmcp-sdk";
import { siteContentSections } from "./site-content";

type AskSiteInput = {
  question: string;
  limit?: number;
};

function searchTerms(value: string) {
  return [...new Set(value.toLocaleLowerCase("en-RW").match(/[a-z0-9]+/g) ?? [])]
    .filter((term) => term.length > 1);
}

export const askSite = defineTool<AskSiteInput>({
  stableKey: "med250.ask_site",
  name: "ask_site",
  title: "Ask MED+250",
  description: "Find MED+250 visitor information about catalogue use, pharmacy requests, privacy, terms, prescriptions, delivery and indicative prices. Use when a visitor asks how the marketplace works or needs policy guidance. Returns matching site-authored sections and source paths without changing the page.",
  inputSchema: {
    type: "object",
    properties: {
      question: { type: "string", minLength: 2, maxLength: 300, description: "The visitor's question, up to 300 characters." },
      limit: { type: "integer", minimum: 1, maximum: 8, default: 5, description: "Maximum matching sections to return, from 1 to 8." },
    },
    required: ["question"],
    additionalProperties: false,
  },
  annotations: { readOnlyHint: true, untrustedContentHint: false },
  async execute({ question, limit = 5 }) {
    const cleanedQuestion = question.trim();
    if (cleanedQuestion.length < 2 || cleanedQuestion.length > 300) {
      throw new Error("Ask a MED+250 question between 2 and 300 characters.");
    }
    if (!Number.isInteger(limit) || limit < 1 || limit > 8) {
      throw new Error("The MED+250 answer limit must be between 1 and 8.");
    }
    const terms = searchTerms(cleanedQuestion);
    const matches = siteContentSections
      .map((section, index) => {
        const title = section.title.toLocaleLowerCase("en-RW");
        const text = section.text.toLocaleLowerCase("en-RW");
        const keywords = new Set(section.keywords.map((keyword) => keyword.toLocaleLowerCase("en-RW")));
        const score = terms.reduce((total, term) => total
          + (keywords.has(term) ? 5 : 0)
          + (title.includes(term) ? 3 : 0)
          + (text.includes(term) ? 1 : 0), 0);
        return { section, score, index };
      })
      .filter(({ score }) => score > 0)
      .toSorted((left, right) => right.score - left.score || left.index - right.index)
      .slice(0, limit)
      .map(({ section }) => ({ title: section.title, text: section.text, sourcePath: section.sourcePath }));

    return {
      question: cleanedQuestion,
      sections: matches,
      note: matches.length
        ? "These are MED+250 site-authored sections. The calling agent should compose the visitor-facing answer without adding medical advice."
        : "MED+250 has no matching visitor guidance for this question.",
    };
  },
});
