
import { useDocumentTitle } from '../../hooks/useDocumentTitle';

const SupplyDashboardPage = () => {
  useDocumentTitle('Tổng quan');


  return (
    <section className="space-y-6">
      <div className="w-fit rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
        <p className="text-xs font-bold uppercase tracking-widest text-green-600">Order vật tư</p>
        <h1 className="mt-2 text-2xl font-bold text-slate-900">Trang dashboard</h1>
      </div>


    </section>
  );
};

export default SupplyDashboardPage;
