import { Fragment, type ReactNode } from 'react';

import {
  assignCaption,
  bucketByDay,
  formatMomentTime,
  type LatelyBucketLabel,
} from '@/lib/lately';
import type { LatelyMilestone } from '@/lib/lately-milestones';
import type { LatelyMoment } from '@/server/db/queries/lately';

import { DayDivider } from './DayDivider';
import { MilestoneRow } from './MilestoneRow';
import { MomentRow } from './MomentRow';
import { FM, FS, INK2, INK3, RULE } from './tokens';
import { UtilityCard } from './UtilityCard';

export type LatelyUtilityProps = {
  caption: string;
  title: ReactNode;
  italicBody?: ReactNode | null;
  regularBody?: ReactNode | null;
  extra?: ReactNode | null;
  action?: ReactNode | null;
  anchorId?: string | null;
};

export type LatelyFeedItem =
  | { kind: 'moment'; id: string; sortAt: Date; moment: LatelyMoment }
  | { kind: 'milestone'; id: string; sortAt: Date; milestone: LatelyMilestone }
  | { kind: 'utility'; id: string; sortAt: Date; utility: LatelyUtilityProps };

type Props = {
  items: LatelyFeedItem[];
  tz: string;
};

export function LatelyFeed({ items, tz }: Props) {
  if (items.length === 0) {
    return (
      <div
        style={{
          fontFamily: FS,
          fontStyle: 'italic',
          fontSize: 16,
          color: INK2,
          textAlign: 'center',
          paddingTop: 40,
          lineHeight: 1.5,
        }}
      >
        No moments yet. They&rsquo;ll appear here once you and your friends start
        answering each other&rsquo;s questions.
      </div>
    );
  }

  const sorted = [...items].sort(
    (a, b) => b.sortAt.getTime() - a.sortAt.getTime(),
  );
  const buckets = bucketByDay(sorted, (i) => i.sortAt, tz);
  const visibleItems = buckets.flatMap((b) => b.items);

  if (visibleItems.length === 0) {
    return (
      <div
        style={{
          fontFamily: FS,
          fontStyle: 'italic',
          fontSize: 16,
          color: INK2,
          textAlign: 'center',
          paddingTop: 40,
          lineHeight: 1.5,
        }}
      >
        No moments yet. They&rsquo;ll appear here once you and your friends start
        answering each other&rsquo;s questions.
      </div>
    );
  }

  const featuredMomentId =
    visibleItems.find((i) => i.kind === 'moment')?.id ?? null;

  return (
    <>
      {buckets.map((bucket) => (
        <Fragment key={bucket.label}>
          <DayDivider label={bucket.label} />
          {bucket.items.map((item) =>
            renderFeedItem(item, bucket.label, tz, featuredMomentId),
          )}
        </Fragment>
      ))}

      <div
        style={{
          marginTop: 36,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          gap: 12,
        }}
      >
        <div style={{ width: 40, height: 1, background: RULE }} />
        <div
          style={{
            fontSize: 9,
            fontFamily: FM,
            color: INK3,
            letterSpacing: 3,
          }}
        >
          END OF FEED
        </div>
        <div style={{ width: 40, height: 1, background: RULE }} />
      </div>
    </>
  );
}

function renderFeedItem(
  item: LatelyFeedItem,
  bucket: LatelyBucketLabel,
  tz: string,
  featuredMomentId: string | null,
) {
  if (item.kind === 'moment') {
    const { moment } = item;
    return (
      <MomentRow
        key={item.id}
        moment={moment}
        caption={assignCaption(
          moment.momentId,
          moment.dir,
          moment.friendFirstName,
        )}
        footnoteTime={formatMomentTime(moment.answeredAt, bucket, tz)}
        featured={item.id === featuredMomentId}
        defaultOpen={item.id === featuredMomentId}
      />
    );
  }

  if (item.kind === 'milestone') {
    return (
      <MilestoneRow
        key={item.id}
        milestone={item.milestone}
        footnoteTime={formatMomentTime(item.sortAt, bucket, tz)}
      />
    );
  }

  return (
    <UtilityCard
      key={item.id}
      caption={item.utility.caption}
      title={item.utility.title}
      italicBody={item.utility.italicBody}
      regularBody={item.utility.regularBody}
      extra={item.utility.extra}
      timestamp={formatMomentTime(item.sortAt, bucket, tz)}
      action={item.utility.action}
      anchorId={item.utility.anchorId}
    />
  );
}
