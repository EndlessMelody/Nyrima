import { useState } from "react";
import { ChevronDown } from "lucide-react";

/**
 * The Q&A accordion. Real disclosure buttons (aria-expanded), one open at a time,
 * keyboard-operable. Lives inside the information panel's glass, so the questions
 * read as part of the scene rather than a buried footer FAQ.
 */
export function FAQPanel({ items }: { items: { q: string; a: string }[] }) {
  const [open, setOpen] = useState<number | null>(0);

  return (
    <ul className="lvn-faq">
      {items.map((item, i) => {
        const isOpen = open === i;
        return (
          <li key={item.q} className={`lvn-faq__item${isOpen ? " is-open" : ""}`}>
            <button
              type="button"
              className="lvn-faq__q"
              aria-expanded={isOpen}
              onClick={() => setOpen(isOpen ? null : i)}
            >
              <span>{item.q}</span>
              <ChevronDown size={16} className="lvn-faq__chevron" aria-hidden="true" />
            </button>
            <div className="lvn-faq__a-wrap" role="region" hidden={!isOpen}>
              <p className="lvn-faq__a">{item.a}</p>
            </div>
          </li>
        );
      })}
    </ul>
  );
}
