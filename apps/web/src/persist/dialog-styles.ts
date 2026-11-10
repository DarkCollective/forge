/*
 * Copyright 2026 Darkcollective, LLC
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */
import { css } from "lit";

/** Form and list styles shared by the save and open dialogs (tokens only). */
export const persistDialogStyles = css`
  .field {
    display: flex;
    flex-direction: column;
    gap: var(--space-1);
    margin-block-end: var(--space-3);
  }
  .field label,
  .field .label {
    font-weight: var(--weight-medium);
    font-size: var(--text-sm);
  }
  .field input[type="text"],
  .field input[type="search"],
  .field textarea {
    width: 100%;
  }
  .check {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    margin-block-end: var(--space-3);
  }
  .check input {
    min-height: 0;
    width: 1.1rem;
    height: 1.1rem;
  }
  .hint {
    color: var(--text-muted);
    font-size: var(--text-sm);
    margin: 0 0 var(--space-3);
  }
  .actions {
    display: flex;
    flex-wrap: wrap;
    gap: var(--space-2);
    justify-content: flex-end;
    margin-block-start: var(--space-3);
  }
  .notice {
    padding: var(--space-2) var(--space-3);
    border: var(--border-width) solid var(--warn);
    background: var(--warn-soft);
    border-radius: var(--radius-m);
    margin-block-end: var(--space-3);
    font-size: var(--text-sm);
  }
  .error {
    padding: var(--space-2) var(--space-3);
    border: var(--border-width) solid var(--danger);
    background: var(--danger-soft);
    border-radius: var(--radius-m);
    margin-block-end: var(--space-3);
    font-size: var(--text-sm);
    white-space: pre-wrap;
  }
  .status {
    font-size: var(--text-sm);
    font-weight: var(--weight-medium);
    margin: 0 0 var(--space-3);
  }
`;
