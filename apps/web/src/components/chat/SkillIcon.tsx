import { memo } from "react";
import { cn } from "~/lib/utils";

const SKILL_ICON_VIEW_BOX = "0 0 24 24";
const SKILL_ICON_STROKE_WIDTH = "2";
const SKILL_ICON_PATH_D = "M13 2L3 14h7l-1 8 10-12h-7l1-8z";

export const SkillIcon = memo(function SkillIcon(props: { className?: string }) {
  return (
    <svg
      aria-hidden="true"
      data-skill-icon="true"
      viewBox={SKILL_ICON_VIEW_BOX}
      fill="none"
      stroke="currentColor"
      strokeWidth={SKILL_ICON_STROKE_WIDTH}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={cn("size-4 shrink-0", props.className)}
    >
      <path d={SKILL_ICON_PATH_D} />
    </svg>
  );
});

export function createSkillIconDomElement(className?: string): SVGSVGElement {
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("aria-hidden", "true");
  svg.setAttribute("data-skill-icon", "true");
  svg.setAttribute("viewBox", SKILL_ICON_VIEW_BOX);
  svg.setAttribute("fill", "none");
  svg.setAttribute("stroke", "currentColor");
  svg.setAttribute("stroke-width", SKILL_ICON_STROKE_WIDTH);
  svg.setAttribute("stroke-linecap", "round");
  svg.setAttribute("stroke-linejoin", "round");
  svg.setAttribute("class", className ?? "size-4 shrink-0");

  const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
  path.setAttribute("d", SKILL_ICON_PATH_D);
  svg.append(path);
  return svg;
}
