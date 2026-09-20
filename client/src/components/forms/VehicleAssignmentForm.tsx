import { useForm } from 'react-hook-form';
import { CrudDrawerForm } from '../crud/CrudDrawerForm';
import { inputClassName, labelClassName } from '../crud/CrudPrimitives';
import type { MilkrunVehicle } from '../../types/milkrun';
import type { UserProfile } from '../../types/users';
export interface AssignmentFormValues { driver_id: string }
export const VehicleAssignmentForm = ({ vehicle, users, loading, failed, busy, onSave }: {
vehicle: MilkrunVehicle; users: UserProfile[]; loading: boolean; failed: boolean; busy: boolean;
onSave: (values: AssignmentFormValues) => Promise<void>;
}) => {
const { register, handleSubmit, formState: { isDirty } } = useForm<AssignmentFormValues>({ defaultValues: { driver_id: vehicle.driver_id ?? '' } });
return (<CrudDrawerForm isDirty={isDirty} busy={busy} submitDisabled={loading || failed} onSubmit={handleSubmit(onSave)}>
            <label className={labelClassName}>
              Tài xế
              <select {...register('driver_id')} className={inputClassName} disabled={loading || failed}>
                <option value="">Chưa gán</option>
                {users
                  .filter((user) => user.is_verified && user.is_active && !user.is_deleted)
                  .map((user) => (
                    <option key={user.id} value={user.id}>
                      {user.first_name} {user.last_name} — {user.vinfast_id}
                    </option>
                  ))}
              </select>
            </label>
            {failed && <p role="alert" className="mt-2 text-sm text-rose-600">Không thể tải danh sách tài xế.</p>}

          </CrudDrawerForm>);
};
