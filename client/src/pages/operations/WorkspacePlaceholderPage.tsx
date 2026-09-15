import { useParams } from "react-router-dom";
import { useDocumentTitle } from '../../hooks/useDocumentTitle';

interface WorkspacePlaceholderPageProps {
  title: string;
  description: string;
}

const WorkspacePlaceholderPage = ({ title, description }: WorkspacePlaceholderPageProps) => {
  useDocumentTitle(title);
  const { id } = useParams<{ id: string }>();

  return (
    <section className="m-auto max-w-2xl rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <p className="text-xs font-bold tracking-widest text-red-600 border p-1 rounded-lg inline-block animate-pulse">
            Tính năng đang phát triển
          </p>
          <h1 className="mt-2 text-2xl font-bold text-slate-900">{title}</h1>
          <p className="mt-2 max-w-2xl text-sm leading-6 text-slate-500">{description}</p>
          {id && <p className="mt-2 text-xs text-slate-400">Order ID: {id}</p>}
        </div>
      </div>
    </section>
  );
};

export default WorkspacePlaceholderPage;
