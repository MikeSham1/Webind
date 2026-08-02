"use client";

import { useState } from "react";
import type {
  OptimizationAsset,
  OptimizationAssets as Assets,
} from "@/lib/optimize/assets";

export default function OptimizationAssets({ assets }: { assets: Assets }) {
  if (assets.assets.length === 0) {
    return (
      <div className="reveal rounded-2xl border border-line bg-surface p-6 text-center">
        <p className="font-sans text-[15px] text-muted">
          No technical fixes to generate — your schema, meta, llms.txt, and AI
          crawler access already look good.
        </p>
      </div>
    );
  }

  return (
    <div className="reveal">
      <div className="mb-5 flex items-baseline justify-between gap-4">
        <h3 className="font-display text-2xl font-semibold text-ink">
          Ready-to-apply fixes
        </h3>
        <span className="hidden font-mono text-xs uppercase tracking-[0.16em] text-muted sm:block">
          Copy &amp; paste
        </span>
      </div>
      <div className="space-y-4">
        {assets.assets.map((asset) => (
          <AssetCard key={asset.key} asset={asset} />
        ))}
      </div>
    </div>
  );
}

function AssetCard({ asset }: { asset: OptimizationAsset }) {
  const [copied, setCopied] = useState(false);

  async function copy() {
    try {
      await navigator.clipboard.writeText(asset.content);
      setCopied(true);
      setTimeout(() => setCopied(false), 1600);
    } catch {
      // Clipboard blocked (e.g. insecure context) — user can still select text.
    }
  }

  return (
    <div className="overflow-hidden rounded-2xl border border-line bg-surface">
      <div className="flex items-start justify-between gap-4 border-b border-line p-5">
        <div>
          <h4 className="font-sans text-[15px] font-semibold text-ink">
            {asset.title}
          </h4>
          <p className="mt-1 max-w-prose text-sm leading-relaxed text-muted">
            {asset.whatItFixes}
          </p>
        </div>
        <button
          type="button"
          onClick={copy}
          className="shrink-0 rounded-full border border-line-strong px-4 py-1.5 font-sans text-sm font-medium text-ink transition-colors hover:border-accent hover:text-accent"
          aria-live="polite"
        >
          {copied ? "Copied ✓" : "Copy"}
        </button>
      </div>
      <pre className="max-h-80 overflow-auto bg-paper p-4 font-mono text-[13px] leading-relaxed text-ink">
        <code>{asset.content}</code>
      </pre>
    </div>
  );
}
