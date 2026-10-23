import type { Meta, StoryObj } from "@storybook/react-vite";
import { type FormEvent, useMemo, useRef, useState } from "react";
import * as UI from "../index.ts";

// Harness scenario: design/scenarios/profile-edit.json (pattern.edit-form).

type Outcome = "accept" | "reject-once" | "manual";
type SaveHooks = { calls: string[]; settle: (result: "accept" | "reject") => void };

declare global {
  interface Window {
    /** Story-only test hook: counts mocked save requests and settles "manual" ones. */
    __profileSave?: SaveHooks;
  }
}

function createMockSave(outcome: Outcome) {
  const hooks: SaveHooks = { calls: [], settle: () => {} };
  if (typeof window !== "undefined") window.__profileSave = hooks;
  return (name: string) =>
    new Promise<void>((resolve, reject) => {
      hooks.calls.push(name);
      const settle = (result: "accept" | "reject") =>
        result === "accept" ? resolve() : reject(new Error("rejected"));
      if (outcome === "manual") hooks.settle = settle;
      else
        setTimeout(
          () => settle(outcome === "reject-once" && hooks.calls.length === 1 ? "reject" : "accept"),
          600,
        );
    });
}

type Status = "idle" | "saving" | "saved" | "failed";

function ProfileEditForm({
  initialName,
  save,
}: {
  initialName: string;
  save: (name: string) => Promise<void>;
}) {
  const [name, setName] = useState(initialName);
  const [savedName, setSavedName] = useState(initialName);
  const [error, setError] = useState<string>();
  const [status, setStatus] = useState<Status>("idle");
  const inFlight = useRef(false);
  const input = useRef<HTMLInputElement>(null);

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (inFlight.current) return;
    const value = name.trim();
    if (!value) {
      setError("表示名を入力してください。");
      input.current?.focus();
      return;
    }
    setError(undefined);
    setStatus("saving");
    inFlight.current = true;
    try {
      await save(value);
      setSavedName(value);
      setStatus("saved");
    } catch {
      setStatus("failed");
    } finally {
      inFlight.current = false;
    }
  }

  return (
    <UI.Stack className="gdg-profile-edit">
      <UI.PageHeader
        title="プロフィール"
        description="イベントの参加者に表示される名前を変更します。"
      />
      <UI.Card>
        <form onSubmit={submit} noValidate>
          <UI.Stack>
            {status === "saved" && (
              <UI.Alert tone="success" title="表示名を保存しました">
                参加者には「{savedName}」と表示されます。
              </UI.Alert>
            )}
            {status === "failed" && (
              <UI.Alert tone="danger" title="表示名を保存できませんでした">
                入力した名前はそのまま残っています。通信状態を確認して、もう一度保存してください。
              </UI.Alert>
            )}
            <UI.FormField
              label="表示名"
              description="イベントページと参加者一覧に表示されます。"
              error={error}
              required
            >
              <UI.Input
                ref={input}
                name="displayName"
                autoComplete="nickname"
                value={name}
                onChange={(event) => setName(event.target.value)}
              />
            </UI.FormField>
            <UI.Inline>
              <UI.Button type="submit" loading={status === "saving"}>
                {status === "failed" ? "もう一度保存" : "保存"}
              </UI.Button>
              <UI.Button
                variant="ghost"
                disabled={status === "saving" || name === savedName}
                onClick={() => {
                  setName(savedName);
                  setError(undefined);
                }}
              >
                元に戻す
              </UI.Button>
            </UI.Inline>
          </UI.Stack>
        </form>
      </UI.Card>
    </UI.Stack>
  );
}

function ProfileEditDemo({ initialName, outcome }: { initialName: string; outcome: Outcome }) {
  const save = useMemo(() => createMockSave(outcome), [outcome]);
  return (
    <main className="gdg-preview">
      <ProfileEditForm key={`${outcome}:${initialName}`} initialName={initialName} save={save} />
    </main>
  );
}

const meta = {
  title: "Patterns/Profile Edit",
  component: ProfileEditDemo,
  args: { initialName: "山田 花子", outcome: "accept" },
  argTypes: {
    outcome: { control: "inline-radio", options: ["accept", "reject-once", "manual"] },
  },
} satisfies Meta<typeof ProfileEditDemo>;
export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};
export const SaveFailsOnce: Story = { args: { outcome: "reject-once" } };
export const LongName: Story = {
  args: {
    initialName:
      "とても長い表示名の確認用テキストとして日本語の名前と所属コミュニティ名をつなげた文字列GDGTokyoOrganizerTeam",
  },
};
