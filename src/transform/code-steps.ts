import type { CheerioAPI } from "cheerio";
import { codeStepsSelector, visibleCodeStep, type CodeStepGroup } from "../importer/code-steps-source.js";

export function flattenCodeSteps($: CheerioAPI, groups: CodeStepGroup[] | undefined): boolean {
  let incomplete = false;
  $(codeStepsSelector).each((index, node) => {
    const figure = $(node);
    const shown = visibleCodeStep($, figure);
    const group = groups?.[index];
    const complete = group && group.steps.length === shown.count;
    if (!complete && (shown.count !== 1 || !shown.code.trim())) incomplete = true;

    const title = group?.title || shown.title;
    const language = group?.language.trim().toLowerCase();
    const steps = complete ? group.steps : [{ code: shown.code, note: shown.note, file: "" }];
    const section = $("<section>").addClass("goldmine-code-steps");
    if (title) section.append($("<p>").append($("<strong>").text(title)));
    const list = $("<ol>");
    for (const step of steps) {
      const item = $("<li>");
      if (step.file && step.file !== title) item.append($("<p>").append($("<strong>").text(step.file)));
      const code = $("<code>").text(step.code);
      if (language && /^[\w+-]+$/u.test(language)) code.addClass(`language-${language}`);
      item.append($("<pre>").append(code));
      if (step.note) item.append($("<p>").text(step.note));
      list.append(item);
    }
    figure.replaceWith(section.append(list));
  });
  return incomplete;
}
