/**
 * Templates service - handles custom workout template CRUD
 */

import { ApiResponse, CustomTemplate, CreateTemplatePayload } from './types';
import { supabase } from '../supabase/client';

function mapTemplateRow(row: any): CustomTemplate {
  return {
    id: row.id,
    name: row.name,
    description: row.description ?? undefined,
    exercises: (row.workout_template_exercises ?? [])
      .sort((a: any, b: any) => a.order_index - b.order_index)
      .map((ex: any) => ({
        id: ex.id,
        name: ex.name,
        category: ex.category,
        orderIndex: ex.order_index,
        targetSets: ex.target_sets,
      })),
    createdAt: new Date(row.created_at),
  };
}

export const templatesService = {
  async getAll(userId: string): Promise<ApiResponse<CustomTemplate[]>> {
    const { data, error } = await supabase
      .from('workout_templates')
      .select('*, workout_template_exercises(*)')
      .eq('user_id', userId)
      .order('created_at', { ascending: false });

    if (error) return { data: [], success: false, error: error.message };
    return { data: (data ?? []).map(mapTemplateRow), success: true };
  },

  async create(userId: string, payload: CreateTemplatePayload): Promise<ApiResponse<CustomTemplate>> {
    const { data: templateRow, error: templateErr } = await supabase
      .from('workout_templates')
      .insert({
        user_id: userId,
        name: payload.name,
        description: payload.description ?? null,
      })
      .select()
      .single();

    if (templateErr || !templateRow) {
      return { data: {} as CustomTemplate, success: false, error: templateErr?.message ?? 'Insert failed' };
    }

    if (payload.exercises.length > 0) {
      const { error: exErr } = await supabase
        .from('workout_template_exercises')
        .insert(
          payload.exercises.map((ex) => ({
            template_id: templateRow.id,
            name: ex.name,
            category: ex.category,
            order_index: ex.orderIndex,
            target_sets: ex.targetSets,
          }))
        );

      if (exErr) {
        return { data: {} as CustomTemplate, success: false, error: exErr.message };
      }
    }

    // Re-fetch to get exercises joined
    const { data: refreshed, error: fetchErr } = await supabase
      .from('workout_templates')
      .select('*, workout_template_exercises(*)')
      .eq('id', templateRow.id)
      .single();

    if (fetchErr || !refreshed) {
      return { data: mapTemplateRow({ ...templateRow, workout_template_exercises: [] }), success: true };
    }

    return { data: mapTemplateRow(refreshed), success: true };
  },

  async delete(templateId: string): Promise<ApiResponse<void>> {
    const { error } = await supabase
      .from('workout_templates')
      .delete()
      .eq('id', templateId);

    if (error) return { data: undefined, success: false, error: error.message };
    return { data: undefined, success: true };
  },
};
