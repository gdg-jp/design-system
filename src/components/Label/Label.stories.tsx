import type { Meta, StoryObj } from "@storybook/react-vite";
import { Input } from "../Input";
import { Label } from "./Label";

const meta = {
  title: "Components/Label",
  component: Label,
  parameters: { layout: "centered" },
} satisfies Meta<typeof Label>;
export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
  render: () => (
    <div className="gdg-field">
      <Label htmlFor="label-example">イベント名</Label>
      <Input id="label-example" placeholder="DevFest" />
    </div>
  ),
};
export const StandaloneField: Story = {
  render: () => (
    <div style={{ width: 256 }}>
      <Label htmlFor="standalone-label">Destination URL</Label>
      <Input id="standalone-label" type="url" placeholder="https://example.com" />
    </div>
  ),
};
