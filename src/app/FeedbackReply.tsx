import type { FeedbackReply as Reply } from '../feedback';

export function FeedbackReply({ reply }: { reply?: Reply }) {
  if (!reply) return null;
  return <section className="feedback-reply" aria-label="개발자 답변">
    <div className="feedback-post-heading"><strong>개발자 답변</strong><time dateTime={reply.updatedAt}>{new Intl.DateTimeFormat('ko-KR', { timeZone: 'Asia/Seoul', dateStyle: 'medium' }).format(new Date(reply.updatedAt))}</time></div>
    <p className="feedback-post-content expanded">{reply.content}</p>
  </section>;
}
