import Link from 'next/link';

import {
  InvitationLandingContent,
  InvitationPageShell,
} from '@/components/invite/InvitationLanding';
import { inviteAcceptanceLabel } from '@/lib/invite-links';

export default function InviteRecipientPreviewPage() {
  return (
    <InvitationPageShell>
      <InvitationLandingContent
        inviterName="Josh"
        categories={[
          { label: 'Ancient History', broadCategory: 'History' },
          { label: 'Space Exploration', broadCategory: 'Science' },
        ]}
        action={
          <Link href="#" className="btn-primary min-h-11 w-full">
            {inviteAcceptanceLabel('Josh')}
          </Link>
        }
      />
    </InvitationPageShell>
  );
}
