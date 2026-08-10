import type { Metadata } from "next";

import { VoiceProfileSettings } from "@/features/settings/voice-profile-settings";

export const metadata: Metadata = {
  title: "Voice Profile | Subzero Mail",
  description: "Inspect and control your compact Subzero Mail writing profile.",
};

export default function VoiceProfilePage() {
  return <VoiceProfileSettings />;
}
