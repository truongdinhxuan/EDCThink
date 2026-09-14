import { Link } from 'react-router-dom';
import { InfoButton } from '../../components/common/Button';
import { getRoleHomePath } from '../../constants/workspaces';
import { useAuth } from '../../context/AuthContext';

const NotFoundPage = () => {
  const { user, role } = useAuth();
  const destination = user ? getRoleHomePath(role) : '/auth/login';

  return (
    <main className="flex min-h-screen items-center justify-center bg-slate-50 px-4">
      <section className="w-full max-w-md rounded-2xl border border-slate-200 bg-white p-8 text-center shadow-sm">
        <p className="text-sm font-bold text-blue-600">404</p>
        <h1 className="mt-2 text-2xl font-bold text-slate-900">
          Không tìm thấy trang
        </h1>
        <p className="mt-3 text-sm leading-6 text-slate-500">
          Đường dẫn không tồn tại hoặc đã được thay đổi. Hãy kiểm tra lại địa
          chỉ hoặc quay về trang làm việc chính.
        </p>
        <Link to={destination} className={`${InfoButton} mt-6`}>
          {user ? 'Về dashboard' : 'Về đăng nhập'}
        </Link>
      </section>
    </main>
  );
};

export default NotFoundPage;
