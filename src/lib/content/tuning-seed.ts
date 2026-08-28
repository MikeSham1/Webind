import type { ContentInputs } from "./types";
import { toTuningRow, type TuningRow } from "./prompt";

/**
 * Curated best-practices seed for the content-writer tune.
 *
 * These are authored instructional exemplars — NOT collected data, NOT copied
 * literature, and NOT fabricated facts. Each output demonstrates FORM (answer-
 * first structure, scannability, page-type-appropriate shape, honest sourcing)
 * using clearly-marked placeholders like [your figure] / [cite source] for any
 * specific claim, exactly as the writer contract requires. They teach the model
 * how to write well before our own approved drafts supplement it.
 *
 * Keep this small and high-quality; a handful of clean exemplars per page type
 * beats volume. Every output must stay placeholder-honest — never assert a real
 * statistic, price, or citation here.
 */

interface SeedExample {
  inputs: ContentInputs;
  output: string;
}

export const CONTENT_TUNING_SEED: SeedExample[] = [
  {
    inputs: {
      topic: "How to choose a commercial roofing contractor",
      pageType: "blog",
      audience: "facilities managers at small-to-mid businesses",
      tone: "professional",
      keyFacts: [],
      keywords: ["commercial roofing contractor", "flat roof repair"],
    },
    output: [
      "# How to Choose a Commercial Roofing Contractor",
      "",
      "The right contractor is licensed, insured, and can show recent work like yours. Start by confirming those three things before you compare quotes.",
      "",
      "## What licenses and insurance should they have?",
      "A commercial roofer should carry a state contractor's license and current general-liability and workers'-comp coverage. Ask for certificates directly from the insurer, not a copy from the contractor.",
      "",
      "## How do you compare quotes fairly?",
      "Put every bid on the same scope so you're comparing like for like:",
      "",
      "- The exact roof system and material grade",
      "- Tear-off vs. overlay, and disposal",
      "- The workmanship warranty length and what voids it",
      "",
      "## What questions surface a weak contractor?",
      "Ask who does the work — the crew or a subcontractor — and for [number] recent references you can call. A contractor who can't produce comparable local projects is a risk, whatever the price.",
      "",
      "*Figures like typical costs vary by region and scope; confirm with quotes rather than a rule of thumb.*",
    ].join("\n"),
  },
  {
    inputs: {
      topic: "Acme Widgets — homepage",
      pageType: "landing",
      audience: "operations leads at small businesses",
      tone: "confident",
      keyFacts: [],
      brandName: "Acme Widgets",
    },
    output: [
      "# Durable widgets that keep your line moving",
      "",
      "Acme Widgets builds hard-wearing widgets for small businesses that can't afford downtime. Fewer failures, faster replacements, one supplier.",
      "",
      "## Why teams switch to Acme",
      "",
      "- **Built to last** — engineered for [your duty cycle] without the early wear cheaper widgets show.",
      "- **In stock, shipped fast** — [your lead time] on standard sizes.",
      "- **Real support** — talk to a person who knows the product, not a script.",
      "",
      "Ready to see the range? [Browse the catalog] or [talk to our team] about a fit for your setup.",
    ].join("\n"),
  },
  {
    inputs: {
      topic: "Acme Pro Widget — product page",
      pageType: "product",
      audience: "buyers comparing industrial widgets",
      tone: "straightforward",
      keyFacts: [],
      keywords: ["industrial widget", "heavy-duty widget"],
    },
    output: [
      "# Acme Pro Widget",
      "",
      "A heavy-duty widget for continuous-use lines, rated for [your load] and built to be serviced in place.",
      "",
      "## Specs",
      "",
      "| Spec | Value |",
      "| --- | --- |",
      "| Material | [material] |",
      "| Rated load | [load] |",
      "| Dimensions | [dimensions] |",
      "| Warranty | [warranty length] |",
      "",
      "## Who it's for",
      "Choose the Pro if you run [use case] and need a widget you can maintain without pulling the line. For lighter duty, the Standard Widget is a better fit.",
      "",
      "Price starts at [your price]. [Request a quote] for volume.",
    ].join("\n"),
  },
  {
    inputs: {
      topic: "About Acme Widgets",
      pageType: "about",
      audience: "prospective customers and partners",
      tone: "warm",
      keyFacts: [],
      brandName: "Acme Widgets",
    },
    output: [
      "# About Acme Widgets",
      "",
      "Acme Widgets was founded in [year] to solve one problem: widgets that fail before they should. We design and build our own, so we own the quality.",
      "",
      "## What we do",
      "We make heavy-duty widgets for [industries we serve], sold direct and through [partners]. Every unit is [how it's tested] before it ships.",
      "",
      "## Who's behind it",
      "The team is led by [founder name], [their background]. You can reach a real person on [support channel] — we answer.",
      "",
      "Want the specifics? See our [product range] or [contact us].",
    ].join("\n"),
  },
  {
    inputs: {
      topic: "Widget maintenance — frequently asked questions",
      pageType: "faq",
      audience: "existing customers",
      tone: "helpful",
      keyFacts: [],
    },
    output: [
      "# Widget Maintenance FAQ",
      "",
      "## How often should I service a widget?",
      "Service it every [interval] under normal use, or sooner if you run [heavy conditions]. Check [what to inspect] at each service.",
      "",
      "## Can I replace parts myself?",
      "Yes — [which parts] are user-replaceable with [tools needed]. For [other parts], contact support so you don't void the [warranty length] warranty.",
      "",
      "## What does the warranty cover?",
      "The warranty covers [what's covered] for [duration]. It doesn't cover [exclusions]. Keep your [proof of purchase] to make a claim.",
    ].join("\n"),
  },
];

/** The seed as tuning rows, ready to concatenate with the collected dataset. */
export function seedTuningRows(): TuningRow[] {
  return CONTENT_TUNING_SEED.map((ex) => toTuningRow(ex.inputs, ex.output));
}
