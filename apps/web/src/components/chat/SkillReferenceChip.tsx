import { memo } from "react";

import { resolveSkillReferenceDisplay } from "~/lib/skillReferenceDisplay";
import { cn } from "~/lib/utils";
import {
  COMPOSER_INLINE_CHIP_CLASS_NAME,
  COMPOSER_INLINE_CHIP_ICON_CLASS_NAME,
  COMPOSER_INLINE_CHIP_LABEL_CLASS_NAME,
} from "../composerInlineChip";
import { createSkillIconDomElement, SkillIcon } from "./SkillIcon";

export const SkillReferenceChip = memo(function SkillReferenceChip(props: {
  skillName: string;
  className?: string;
}) {
  return (
    <span className={cn(COMPOSER_INLINE_CHIP_CLASS_NAME, props.className)}>
      <SkillIcon className={COMPOSER_INLINE_CHIP_ICON_CLASS_NAME} />
      <span className={COMPOSER_INLINE_CHIP_LABEL_CLASS_NAME}>{props.skillName}</span>
    </span>
  );
});

export function createSkillReferenceChipDomElement(
  pathValue: string,
  className: string,
  iconClassName: string,
  labelClassName: string,
): HTMLElement | null {
  const display = resolveSkillReferenceDisplay(pathValue);
  if (!display) {
    return null;
  }

  const container = document.createElement("span");
  container.className = className;

  const label = document.createElement("span");
  label.className = labelClassName;
  label.textContent = display.label;

  container.append(createSkillIconDomElement(iconClassName), label);
  return container;
}
