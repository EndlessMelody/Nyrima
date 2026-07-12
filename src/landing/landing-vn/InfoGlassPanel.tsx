import type { ReactNode } from "react";
import { ArrowUpRight } from "lucide-react";
import type { Chapter, PanelContent, Subsection } from "./landingSections";
import { FeatureCardGrid } from "./FeatureCardGrid";
import { TechStackGrid } from "./TechStackGrid";
import { FAQPanel } from "./FAQPanel";

/**
 * The large glassmorphism information panel. It fills the content region when a
 * chapter is open, keeping the night sky and Ny-chan visible behind it so it
 * reads as part of the VN stage, not a separate web page.
 *
 * `header` is the chapter identity + subsection tabs the stage hands in, so the
 * whole thing is one cohesive glass card: chrome on top, a re-animating content
 * body below. The body shape is chosen by `panel.kind`; it re-keys per
 * subsection so it fades/slides in on every switch.
 */
export function InfoGlassPanel({
  chapter,
  subsection,
  header,
}: {
  chapter: Chapter;
  subsection: Subsection;
  header: ReactNode;
}) {
  return (
    <aside className="lvn-panel" aria-label={`${chapter.title}: ${subsection.label}`}>
      <div className="lvn-panel__chrome">{header}</div>
      <div className="lvn-panel__scroll">
        <div className="lvn-panel__body" key={subsection.id}>
          {renderPanel(subsection.panel)}
        </div>
      </div>
    </aside>
  );
}

function renderPanel(panel: PanelContent): ReactNode {
  switch (panel.kind) {
    case "about":
      return (
        <>
          <p className="lvn-lead">{panel.lead}</p>
          <FeatureCardGrid items={panel.cards} />
        </>
      );
    case "painPoints":
      return <PainPointGrid pairs={panel.pairs} />;
    case "steps":
      return <FeatureCardGrid items={panel.steps} numbered />;
    case "features":
      return <FeatureCardGrid items={panel.cards} />;
    case "tech":
      return <TechStackGrid activeId={panel.activeId} />;
    case "policy":
      return <PolicyBlocks tone={panel.tone} blocks={panel.blocks} />;
    case "faq":
      return <FAQPanel items={panel.items} />;
    case "prose":
      return <ProseBlocks lead={panel.lead} blocks={panel.blocks} pills={panel.pills} />;
    case "profile":
      return <ProfileCard panel={panel} />;
    default:
      return null;
  }
}

/* ── pain points: problem → solution ───────────────────────────────────────── */
function PainPointGrid({
  pairs,
}: {
  pairs: { problem: string; solution: string }[];
}) {
  return (
    <ul className="lvn-pains">
      {pairs.map((pair, i) => (
        <li
          key={pair.problem}
          className="lvn-pain"
          style={{ "--d": `${i * 60}ms` } as React.CSSProperties}
        >
          <span className="lvn-pain__from">{pair.problem}</span>
          <span className="lvn-pain__arrow" aria-hidden="true">
            →
          </span>
          <span className="lvn-pain__to">{pair.solution}</span>
        </li>
      ))}
    </ul>
  );
}

/* ── privacy / commitments: titled bullet panels ───────────────────────────── */
type PolicyBlock = Extract<PanelContent, { kind: "policy" }>["blocks"][number];

function PolicyBlocks({
  tone,
  blocks,
}: {
  tone: "privacy" | "commitments";
  blocks: PolicyBlock[];
}) {
  return (
    <ul className={`lvn-policy lvn-policy--${tone}`}>
      {blocks.map((block, i) => {
        const Icon = block.icon;
        return (
          <li
            key={block.title}
            className="lvn-policy__block"
            style={{ "--d": `${i * 55}ms` } as React.CSSProperties}
          >
            <div className="lvn-policy__head">
              <span className="lvn-policy__icon" aria-hidden="true">
                <Icon size={18} />
              </span>
              <h4 className="lvn-policy__title">{block.title}</h4>
            </div>
            <ul className="lvn-policy__points">
              {block.points.map((point: string) => (
                <li key={point}>{point}</li>
              ))}
            </ul>
          </li>
        );
      })}
    </ul>
  );
}

/* ── prose: lead + titled paragraphs + optional pills ──────────────────────── */
function ProseBlocks({
  lead,
  blocks,
  pills,
}: {
  lead?: string;
  blocks: { title?: string; body: string }[];
  pills?: string[];
}) {
  return (
    <div className="lvn-prose">
      {lead ? <p className="lvn-lead">{lead}</p> : null}
      {blocks.map((block, i) => (
        <div
          key={block.title ?? i}
          className="lvn-prose__block"
          style={{ "--d": `${i * 60}ms` } as React.CSSProperties}
        >
          {block.title ? <h4 className="lvn-prose__title">{block.title}</h4> : null}
          <p className="lvn-prose__body">{block.body}</p>
        </div>
      ))}
      {pills && pills.length ? (
        <ul className="lvn-pills lvn-pills--center">
          {pills.map((pill) => (
            <li key={pill} className="lvn-pill">
              {pill}
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}

/* ── developer profile card ────────────────────────────────────────────────── */
function ProfileCard({
  panel,
}: {
  panel: Extract<PanelContent, { kind: "profile" }>;
}) {
  return (
    <div className="lvn-profile">
      <div className="lvn-profile__head">
        <span className="lvn-profile__avatar" aria-hidden="true">
          {panel.name.slice(0, 1)}
        </span>
        <div className="lvn-profile__id">
          <span className="lvn-profile__name">{panel.name}</span>
          <span className="lvn-profile__role">{panel.role}</span>
        </div>
      </div>
      <p className="lvn-profile__blurb">{panel.blurb}</p>
      <ul className="lvn-pills">
        {panel.pills.map((pill) => (
          <li key={pill} className="lvn-pill">
            {pill}
          </li>
        ))}
      </ul>
      <div className="lvn-profile__links">
        {panel.links.map((link) => {
          const Icon = link.icon;
          const external = link.href.startsWith("http");
          return (
            <a
              key={link.label}
              className="lvn-profile__link"
              href={link.href}
              {...(external ? { target: "_blank", rel: "noreferrer" } : {})}
            >
              <Icon size={15} />
              <span>{link.label}</span>
              {external ? <ArrowUpRight size={13} aria-hidden="true" /> : null}
            </a>
          );
        })}
      </div>
    </div>
  );
}
