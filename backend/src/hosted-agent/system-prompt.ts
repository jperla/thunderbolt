/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import { languageInstruction } from '@shared/i18n/language-instruction'
import { matchExactLocale, sourceLocale } from '@shared/i18n/locales'

/**
 * Build the hosted agent's system prompt for one request: the operator's `AGENT_SYSTEM_PROMPT` first, then
 * a language rule whose fallback names the app language from the request's `X-App-Language` header.
 *
 * The header is client-controlled, so {@link matchExactLocale} validates it and only a shipped tag's English
 * name reaches the prompt; an absent or unknown tag falls back to English. The prompt body stays English,
 * like the built-in pipeline's.
 *
 * @param operatorPrompt `AGENT_SYSTEM_PROMPT`, empty when unset.
 * @param appLanguage Raw `X-App-Language` header value, or null when absent.
 */
export const buildAgentSystemPrompt = (operatorPrompt: string, appLanguage: string | null): string => {
  const language = languageInstruction(matchExactLocale(appLanguage) ?? sourceLocale, { toolResults: false })
  return operatorPrompt ? `${operatorPrompt}\n\n${language}` : language
}
