import { TECH_MODULES } from "./landingSections";

/**
 * The three tech modules as large grid cards. All three are always visible so
 * the visitor sees the whole picture; the subsection they picked (UI / Media /
 * Data) is the highlighted, expanded card showing its pills and its
 * "what this does for Nyrima" note. The others stay as calmer summaries.
 */
export function TechStackGrid({ activeId }: { activeId: string }) {
  return (
    <ul className="lvn-tech">
      {TECH_MODULES.map((mod, i) => {
        const Icon = mod.icon;
        const active = mod.id === activeId;
        return (
          <li
            key={mod.id}
            className={`lvn-tech__card${active ? " is-active" : ""}`}
            style={{ "--d": `${i * 70}ms` } as React.CSSProperties}
          >
            <div className="lvn-tech__head">
              <span className="lvn-tech__icon" aria-hidden="true">
                <Icon size={20} />
              </span>
              <h4 className="lvn-tech__title">{mod.title}</h4>
            </div>
            <p className="lvn-tech__desc">{mod.desc}</p>
            <ul className="lvn-pills" aria-label={`${mod.title} technologies`}>
              {mod.pills.map((pill) => (
                <li key={pill} className="lvn-pill">
                  {pill}
                </li>
              ))}
            </ul>
            {active ? (
              <p className="lvn-tech__impact">
                <span className="lvn-tech__impact-label">What this does for Nyrima</span>
                {mod.impact}
              </p>
            ) : null}
          </li>
        );
      })}
    </ul>
  );
}
