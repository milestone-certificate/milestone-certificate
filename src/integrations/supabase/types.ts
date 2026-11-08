export type Json = string | number | boolean | null | { [key: string]: Json | undefined } | Json[];

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "14.18";
  };
  public: {
    Tables: {
      agent_accounts: {
        Row: {
          active: boolean;
          agent_code: string | null;
          created_at: string;
          full_name: string;
          has_unpaid: boolean;
          mobile: string;
          parent_agent_id: string | null;
          role: Database["public"]["Enums"]["app_role"];
          user_id: string;
        };
        Insert: {
          active?: boolean;
          agent_code?: string | null;
          created_at?: string;
          full_name: string;
          has_unpaid?: boolean;
          mobile: string;
          parent_agent_id?: string | null;
          role: Database["public"]["Enums"]["app_role"];
          user_id: string;
        };
        Update: {
          active?: boolean;
          agent_code?: string | null;
          created_at?: string;
          full_name?: string;
          has_unpaid?: boolean;
          mobile?: string;
          parent_agent_id?: string | null;
          role?: Database["public"]["Enums"]["app_role"];
          user_id?: string;
        };
        Relationships: [];
      };
      appointment_extractions: {
        Row: {
          confidence: number | null;
          correction_reason: string | null;
          created_at: string;
          created_by: string;
          error: string | null;
          extracted: Json;
          id: string;
          old_exam_at: string | null;
          reviewed_at: string | null;
          reviewed_by: string | null;
          status: string;
          submission_id: string;
          verified_exam_at: string | null;
          verified_reporting_time: string | null;
          warnings: Json;
        };
        Insert: {
          confidence?: number | null;
          correction_reason?: string | null;
          created_at?: string;
          created_by: string;
          error?: string | null;
          extracted?: Json;
          id?: string;
          old_exam_at?: string | null;
          reviewed_at?: string | null;
          reviewed_by?: string | null;
          status?: string;
          submission_id: string;
          verified_exam_at?: string | null;
          verified_reporting_time?: string | null;
          warnings?: Json;
        };
        Update: {
          confidence?: number | null;
          correction_reason?: string | null;
          created_at?: string;
          created_by?: string;
          error?: string | null;
          extracted?: Json;
          id?: string;
          old_exam_at?: string | null;
          reviewed_at?: string | null;
          reviewed_by?: string | null;
          status?: string;
          submission_id?: string;
          verified_exam_at?: string | null;
          verified_reporting_time?: string | null;
          warnings?: Json;
        };
        Relationships: [
          {
            foreignKeyName: "appointment_extractions_submission_id_fkey";
            columns: ["submission_id"];
            isOneToOne: false;
            referencedRelation: "job_submissions";
            referencedColumns: ["id"];
          },
        ];
      };
      candidates: {
        Row: {
          arrival_status: string;
          created_at: string;
          date_of_birth: string | null;
          district: string | null;
          fee_amount: number;
          id: string;
          mobile: string | null;
          name: string;
          needs_follow_up: boolean;
          notes: string | null;
          occupation_id: string | null;
          passport_expiry: string | null;
          passport_no: string | null;
          photo_url: string | null;
          received_at: string | null;
          received_by: string | null;
          registration_no: string | null;
          result_check_at: string | null;
          secondary_mobile: string | null;
          skill_details: string | null;
          ttc_id: string | null;
          updated_at: string;
        };
        Insert: {
          arrival_status?: string;
          created_at?: string;
          date_of_birth?: string | null;
          district?: string | null;
          fee_amount?: number;
          id?: string;
          mobile?: string | null;
          name: string;
          needs_follow_up?: boolean;
          notes?: string | null;
          occupation_id?: string | null;
          passport_expiry?: string | null;
          passport_no?: string | null;
          photo_url?: string | null;
          received_at?: string | null;
          received_by?: string | null;
          registration_no?: string | null;
          result_check_at?: string | null;
          secondary_mobile?: string | null;
          skill_details?: string | null;
          ttc_id?: string | null;
          updated_at?: string;
        };
        Update: {
          arrival_status?: string;
          created_at?: string;
          date_of_birth?: string | null;
          district?: string | null;
          fee_amount?: number;
          id?: string;
          mobile?: string | null;
          name?: string;
          needs_follow_up?: boolean;
          notes?: string | null;
          occupation_id?: string | null;
          passport_expiry?: string | null;
          passport_no?: string | null;
          photo_url?: string | null;
          received_at?: string | null;
          received_by?: string | null;
          registration_no?: string | null;
          result_check_at?: string | null;
          secondary_mobile?: string | null;
          skill_details?: string | null;
          ttc_id?: string | null;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "candidates_occupation_id_fkey";
            columns: ["occupation_id"];
            isOneToOne: false;
            referencedRelation: "occupations";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "candidates_ttc_id_fkey";
            columns: ["ttc_id"];
            isOneToOne: false;
            referencedRelation: "ttc_centers";
            referencedColumns: ["id"];
          },
        ];
      };
      device_sessions: {
        Row: {
          prev_session_key: string | null;
          session_key: string;
          updated_at: string;
          user_id: string;
        };
        Insert: {
          prev_session_key?: string | null;
          session_key: string;
          updated_at?: string;
          user_id: string;
        };
        Update: {
          prev_session_key?: string | null;
          session_key?: string;
          updated_at?: string;
          user_id?: string;
        };
        Relationships: [];
      };
      exams: {
        Row: {
          svp_auto_checked_at: string | null;
          svp_auto_lease_token: string | null;
          svp_auto_lease_until: string | null;
          svp_auto_outcome: string | null;
          candidate_id: string;
          created_at: string;
          exam_date: string;
          exam_time: string | null;
          exam_type: string;
          id: string;
          occupation_id: string | null;
          remarks: string | null;
          result: Database["public"]["Enums"]["exam_result"];
          result_date: string | null;
          result_last_checked_at: string | null;
          score: number | null;
          submission_id: string | null;
          ttc_id: string | null;
        };
        Insert: {
          svp_auto_checked_at?: string | null;
          svp_auto_lease_token?: string | null;
          svp_auto_lease_until?: string | null;
          svp_auto_outcome?: string | null;
          candidate_id: string;
          created_at?: string;
          exam_date: string;
          exam_time?: string | null;
          exam_type?: string;
          id?: string;
          occupation_id?: string | null;
          remarks?: string | null;
          result?: Database["public"]["Enums"]["exam_result"];
          result_date?: string | null;
          result_last_checked_at?: string | null;
          score?: number | null;
          submission_id?: string | null;
          ttc_id?: string | null;
        };
        Update: {
          svp_auto_checked_at?: string | null;
          svp_auto_lease_token?: string | null;
          svp_auto_lease_until?: string | null;
          svp_auto_outcome?: string | null;
          candidate_id?: string;
          created_at?: string;
          exam_date?: string;
          exam_time?: string | null;
          exam_type?: string;
          id?: string;
          occupation_id?: string | null;
          remarks?: string | null;
          result?: Database["public"]["Enums"]["exam_result"];
          result_date?: string | null;
          result_last_checked_at?: string | null;
          score?: number | null;
          submission_id?: string | null;
          ttc_id?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: "exams_candidate_id_fkey";
            columns: ["candidate_id"];
            isOneToOne: false;
            referencedRelation: "candidates";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "exams_occupation_id_fkey";
            columns: ["occupation_id"];
            isOneToOne: false;
            referencedRelation: "occupations";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "exams_submission_id_fkey";
            columns: ["submission_id"];
            isOneToOne: false;
            referencedRelation: "job_submissions";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "exams_ttc_id_fkey";
            columns: ["ttc_id"];
            isOneToOne: false;
            referencedRelation: "ttc_centers";
            referencedColumns: ["id"];
          },
        ];
      };
      job_submissions: {
        Row: {
          arrival_status: string;
          candidate_id: string | null;
          candidate_name: string;
          candidate_photo_path: string | null;
          created_at: string;
          education: string;
          exam_at: string;
          exam_id: string | null;
          experience: string;
          id: string;
          mobile: string;
          occupation_id: string | null;
          ocr_meta: Json | null;
          passport_no: string;
          received_at: string | null;
          received_by: string | null;
          ref_code: string;
          ref_no: number;
          rejection_reason: string | null;
          reviewed_at: string | null;
          reviewed_by: string | null;
          secondary_mobile: string | null;
          skill_details: string | null;
          status: string;
          submitted_by: string;
          svp_checked_at: string | null;
          svp_exam_date: string | null;
          svp_old_result: string | null;
          svp_result: string;
          terms_accepted: boolean;
          ticket_path: string;
          ttc_id: string | null;
        };
        Insert: {
          arrival_status?: string;
          candidate_id?: string | null;
          candidate_name: string;
          candidate_photo_path?: string | null;
          created_at?: string;
          education: string;
          exam_at: string;
          exam_id?: string | null;
          experience: string;
          id?: string;
          mobile: string;
          occupation_id?: string | null;
          ocr_meta?: Json | null;
          passport_no: string;
          received_at?: string | null;
          received_by?: string | null;
          ref_code?: string;
          ref_no?: never;
          rejection_reason?: string | null;
          reviewed_at?: string | null;
          reviewed_by?: string | null;
          secondary_mobile?: string | null;
          skill_details?: string | null;
          status?: string;
          submitted_by?: string;
          svp_checked_at?: string | null;
          svp_exam_date?: string | null;
          svp_old_result?: string | null;
          svp_result?: string;
          terms_accepted: boolean;
          ticket_path: string;
          ttc_id?: string | null;
        };
        Update: {
          arrival_status?: string;
          candidate_id?: string | null;
          candidate_name?: string;
          candidate_photo_path?: string | null;
          created_at?: string;
          education?: string;
          exam_at?: string;
          exam_id?: string | null;
          experience?: string;
          id?: string;
          mobile?: string;
          occupation_id?: string | null;
          ocr_meta?: Json | null;
          passport_no?: string;
          received_at?: string | null;
          received_by?: string | null;
          ref_code?: string;
          ref_no?: never;
          rejection_reason?: string | null;
          reviewed_at?: string | null;
          reviewed_by?: string | null;
          secondary_mobile?: string | null;
          skill_details?: string | null;
          status?: string;
          submitted_by?: string;
          svp_checked_at?: string | null;
          svp_exam_date?: string | null;
          svp_old_result?: string | null;
          svp_result?: string;
          terms_accepted?: boolean;
          ticket_path?: string;
          ttc_id?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: "job_submissions_candidate_id_fkey";
            columns: ["candidate_id"];
            isOneToOne: false;
            referencedRelation: "candidates";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "job_submissions_exam_id_fkey";
            columns: ["exam_id"];
            isOneToOne: false;
            referencedRelation: "exams";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "job_submissions_occupation_id_fkey";
            columns: ["occupation_id"];
            isOneToOne: false;
            referencedRelation: "occupations";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "job_submissions_ttc_id_fkey";
            columns: ["ttc_id"];
            isOneToOne: false;
            referencedRelation: "ttc_centers";
            referencedColumns: ["id"];
          },
        ];
      };
      notifications: {
        Row: {
          body: string | null;
          created_at: string;
          id: string;
          kind: string;
          read: boolean;
          submission_id: string | null;
          title: string;
          user_id: string;
        };
        Insert: {
          body?: string | null;
          created_at?: string;
          id?: string;
          kind: string;
          read?: boolean;
          submission_id?: string | null;
          title: string;
          user_id: string;
        };
        Update: {
          body?: string | null;
          created_at?: string;
          id?: string;
          kind?: string;
          read?: boolean;
          submission_id?: string | null;
          title?: string;
          user_id?: string;
        };
        Relationships: [];
      };
      occupations: {
        Row: {
          active: boolean;
          created_at: string;
          id: string;
          name: string;
          svp_key: string | null;
        };
        Insert: {
          active?: boolean;
          created_at?: string;
          id?: string;
          name: string;
          svp_key?: string | null;
        };
        Update: {
          active?: boolean;
          created_at?: string;
          id?: string;
          name?: string;
          svp_key?: string | null;
        };
        Relationships: [];
      };
      payments: {
        Row: {
          amount: number;
          candidate_id: string;
          created_at: string;
          created_by: string;
          id: string;
          method: string;
          reviewed_at: string | null;
          reviewed_by: string | null;
          sender: string;
          status: string;
          trx_id: string;
        };
        Insert: {
          amount: number;
          candidate_id: string;
          created_at?: string;
          created_by?: string;
          id?: string;
          method: string;
          reviewed_at?: string | null;
          reviewed_by?: string | null;
          sender: string;
          status?: string;
          trx_id: string;
        };
        Update: {
          amount?: number;
          candidate_id?: string;
          created_at?: string;
          created_by?: string;
          id?: string;
          method?: string;
          reviewed_at?: string | null;
          reviewed_by?: string | null;
          sender?: string;
          status?: string;
          trx_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "payments_candidate_id_fkey";
            columns: ["candidate_id"];
            isOneToOne: false;
            referencedRelation: "candidates";
            referencedColumns: ["id"];
          },
        ];
      };
      phone_otps: {
        Row: {
          attempts: number;
          code_hash: string;
          expires_at: string;
          last_sent_at: string;
          phone: string;
        };
        Insert: {
          attempts?: number;
          code_hash: string;
          expires_at: string;
          last_sent_at?: string;
          phone: string;
        };
        Update: {
          attempts?: number;
          code_hash?: string;
          expires_at?: string;
          last_sent_at?: string;
          phone?: string;
        };
        Relationships: [];
      };
      profiles: {
        Row: {
          created_at: string;
          email: string | null;
          full_name: string | null;
          id: string;
        };
        Insert: {
          created_at?: string;
          email?: string | null;
          full_name?: string | null;
          id: string;
        };
        Update: {
          created_at?: string;
          email?: string | null;
          full_name?: string | null;
          id?: string;
        };
        Relationships: [];
      };
      receive_status_log: {
        Row: {
          changed_at: string;
          changed_by: string;
          changed_by_name: string | null;
          id: string;
          new_status: string;
          old_status: string | null;
          submission_id: string;
        };
        Insert: {
          changed_at?: string;
          changed_by: string;
          changed_by_name?: string | null;
          id?: string;
          new_status: string;
          old_status?: string | null;
          submission_id: string;
        };
        Update: {
          changed_at?: string;
          changed_by?: string;
          changed_by_name?: string | null;
          id?: string;
          new_status?: string;
          old_status?: string | null;
          submission_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "receive_status_log_submission_id_fkey";
            columns: ["submission_id"];
            isOneToOne: false;
            referencedRelation: "job_submissions";
            referencedColumns: ["id"];
          },
        ];
      };
      reminders: {
        Row: {
          candidate_id: string | null;
          created_at: string;
          done: boolean;
          due_date: string;
          id: string;
          title: string;
        };
        Insert: {
          candidate_id?: string | null;
          created_at?: string;
          done?: boolean;
          due_date: string;
          id?: string;
          title: string;
        };
        Update: {
          candidate_id?: string | null;
          created_at?: string;
          done?: boolean;
          due_date?: string;
          id?: string;
          title?: string;
        };
        Relationships: [
          {
            foreignKeyName: "reminders_candidate_id_fkey";
            columns: ["candidate_id"];
            isOneToOne: false;
            referencedRelation: "candidates";
            referencedColumns: ["id"];
          },
        ];
      };
      results: {
        Row: {
          candidate_id: string;
          created_at: string;
          exam_id: string;
          id: string;
          result: Database["public"]["Enums"]["exam_result"];
          result_date: string | null;
          score: number | null;
          source: string;
        };
        Insert: {
          candidate_id: string;
          created_at?: string;
          exam_id: string;
          id?: string;
          result: Database["public"]["Enums"]["exam_result"];
          result_date?: string | null;
          score?: number | null;
          source?: string;
        };
        Update: {
          candidate_id?: string;
          created_at?: string;
          exam_id?: string;
          id?: string;
          result?: Database["public"]["Enums"]["exam_result"];
          result_date?: string | null;
          score?: number | null;
          source?: string;
        };
        Relationships: [
          {
            foreignKeyName: "results_candidate_id_fkey";
            columns: ["candidate_id"];
            isOneToOne: false;
            referencedRelation: "candidates";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "results_exam_id_fkey";
            columns: ["exam_id"];
            isOneToOne: false;
            referencedRelation: "exams";
            referencedColumns: ["id"];
          },
        ];
      };
      settings: {
        Row: {
          key: string;
          value: string | null;
        };
        Insert: {
          key: string;
          value?: string | null;
        };
        Update: {
          key?: string;
          value?: string | null;
        };
        Relationships: [];
      };
      sms_automations: {
        Row: {
          active: boolean;
          created_at: string;
          custom_at: string | null;
          filter: Json;
          id: string;
          last_run_on: string | null;
          name: string;
          schedule: string;
          send_hour: number;
          template_id: string;
        };
        Insert: {
          active?: boolean;
          created_at?: string;
          custom_at?: string | null;
          filter?: Json;
          id?: string;
          last_run_on?: string | null;
          name: string;
          schedule?: string;
          send_hour?: number;
          template_id: string;
        };
        Update: {
          active?: boolean;
          created_at?: string;
          custom_at?: string | null;
          filter?: Json;
          id?: string;
          last_run_on?: string | null;
          name?: string;
          schedule?: string;
          send_hour?: number;
          template_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "sms_automations_template_id_fkey";
            columns: ["template_id"];
            isOneToOne: false;
            referencedRelation: "sms_templates";
            referencedColumns: ["id"];
          },
        ];
      };
      sms_log: {
        Row: {
          created_at: string;
          id: string;
          kind: string;
          ok: boolean;
          phone: string;
          ref_key: string;
        };
        Insert: {
          created_at?: string;
          id?: string;
          kind: string;
          ok?: boolean;
          phone: string;
          ref_key: string;
        };
        Update: {
          created_at?: string;
          id?: string;
          kind?: string;
          ok?: boolean;
          phone?: string;
          ref_key?: string;
        };
        Relationships: [];
      };
      sms_messages: {
        Row: {
          automation_id: string | null;
          body: string;
          created_at: string;
          created_by: string | null;
          dedupe_key: string;
          error: string | null;
          id: string;
          phone: string;
          recipient_name: string | null;
          sent_at: string | null;
          status: string;
          submission_id: string | null;
        };
        Insert: {
          automation_id?: string | null;
          body: string;
          created_at?: string;
          created_by?: string | null;
          dedupe_key: string;
          error?: string | null;
          id?: string;
          phone: string;
          recipient_name?: string | null;
          sent_at?: string | null;
          status?: string;
          submission_id?: string | null;
        };
        Update: {
          automation_id?: string | null;
          body?: string;
          created_at?: string;
          created_by?: string | null;
          dedupe_key?: string;
          error?: string | null;
          id?: string;
          phone?: string;
          recipient_name?: string | null;
          sent_at?: string | null;
          status?: string;
          submission_id?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: "sms_messages_automation_id_fkey";
            columns: ["automation_id"];
            isOneToOne: false;
            referencedRelation: "sms_automations";
            referencedColumns: ["id"];
          },
        ];
      };
      sms_templates: {
        Row: {
          agent_id: string | null;
          body: string;
          created_at: string;
          id: string;
          name: string;
          ttc_id: string | null;
        };
        Insert: {
          agent_id?: string | null;
          body: string;
          created_at?: string;
          id?: string;
          name: string;
          ttc_id?: string | null;
        };
        Update: {
          agent_id?: string | null;
          body?: string;
          created_at?: string;
          id?: string;
          name?: string;
          ttc_id?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: "sms_templates_ttc_id_fkey";
            columns: ["ttc_id"];
            isOneToOne: false;
            referencedRelation: "ttc_centers";
            referencedColumns: ["id"];
          },
        ];
      };
      svp_bookings: {
        Row: {
          agency: string | null;
          candidate_name: string;
          center: string | null;
          created_at: string;
          created_by: string | null;
          exam_date: string | null;
          exam_time: string | null;
          id: string;
          login_email: string | null;
          notes: string | null;
          occupation: string | null;
          passport: string;
          reference_no: string | null;
          status: string;
          updated_at: string;
        };
        Insert: {
          agency?: string | null;
          candidate_name: string;
          center?: string | null;
          created_at?: string;
          created_by?: string | null;
          exam_date?: string | null;
          exam_time?: string | null;
          id?: string;
          login_email?: string | null;
          notes?: string | null;
          occupation?: string | null;
          passport: string;
          reference_no?: string | null;
          status?: string;
          updated_at?: string;
        };
        Update: {
          agency?: string | null;
          candidate_name?: string;
          center?: string | null;
          created_at?: string;
          created_by?: string | null;
          exam_date?: string | null;
          exam_time?: string | null;
          id?: string;
          login_email?: string | null;
          notes?: string | null;
          occupation?: string | null;
          passport?: string;
          reference_no?: string | null;
          status?: string;
          updated_at?: string;
        };
        Relationships: [];
      };
      ttc_centers: {
        Row: {
          active: boolean;
          address: string | null;
          created_at: string;
          district: string | null;
          id: string;
          name: string;
          sort_order: number;
        };
        Insert: {
          active?: boolean;
          address?: string | null;
          created_at?: string;
          district?: string | null;
          id?: string;
          name: string;
          sort_order?: number;
        };
        Update: {
          active?: boolean;
          address?: string | null;
          created_at?: string;
          district?: string | null;
          id?: string;
          name?: string;
          sort_order?: number;
        };
        Relationships: [];
      };
      user_roles: {
        Row: {
          id: string;
          role: Database["public"]["Enums"]["app_role"];
          user_id: string;
        };
        Insert: {
          id?: string;
          role: Database["public"]["Enums"]["app_role"];
          user_id: string;
        };
        Update: {
          id?: string;
          role?: Database["public"]["Enums"]["app_role"];
          user_id?: string;
        };
        Relationships: [];
      };
      work_notes: {
        Row: {
          author_id: string;
          body: string;
          created_at: string;
          id: string;
          kind: string;
          submission_id: string;
        };
        Insert: {
          author_id?: string;
          body: string;
          created_at?: string;
          id?: string;
          kind?: string;
          submission_id: string;
        };
        Update: {
          author_id?: string;
          body?: string;
          created_at?: string;
          id?: string;
          kind?: string;
          submission_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "work_notes_submission_id_fkey";
            columns: ["submission_id"];
            isOneToOne: false;
            referencedRelation: "job_submissions";
            referencedColumns: ["id"];
          },
        ];
      };
      rspay_gateway_settings: {
        Row: {
          id: number;
          enabled: boolean;
          bkash: boolean;
          nagad: boolean;
          rocket: boolean;
          upay: boolean;
          updated_by: string | null;
          updated_at: string;
        };
        Insert: {
          id?: number;
          enabled?: boolean;
          bkash?: boolean;
          nagad?: boolean;
          rocket?: boolean;
          upay?: boolean;
          updated_by?: string | null;
          updated_at?: string;
        };
        Update: {
          enabled?: boolean;
          bkash?: boolean;
          nagad?: boolean;
          rocket?: boolean;
          upay?: boolean;
          updated_by?: string | null;
          updated_at?: string;
        };
        Relationships: [];
      };
      rspay_gateway_audit: {
        Row: {
          id: string;
          control: string;
          old_value: boolean;
          new_value: boolean;
          changed_by: string | null;
          created_at: string;
        };
        Insert: {
          id?: string;
          control: string;
          old_value: boolean;
          new_value: boolean;
          changed_by?: string | null;
          created_at?: string;
        };
        Update: {
          control?: string;
          old_value?: boolean;
          new_value?: boolean;
          changed_by?: string | null;
          created_at?: string;
        };
        Relationships: [];
      };
      wallet_accounts: {
        Row: {
          balance: number;
          created_at: string;
          updated_at: string;
          user_id: string;
        };
        Insert: {
          balance?: number;
          created_at?: string;
          updated_at?: string;
          user_id: string;
        };
        Update: {
          balance?: number;
          created_at?: string;
          updated_at?: string;
          user_id?: string;
        };
        Relationships: [];
      };
      wallet_deposits: {
        Row: {
          provider: string;
          gateway_status: string | null;
          gateway_short_code: string | null;
          gateway_transaction_id: string | null;
          amount: number;
          created_at: string;
          id: string;
          method: string;
          note: string | null;
          reference: string | null;
          review_note: string | null;
          reviewed_at: string | null;
          reviewed_by: string | null;
          status: string;
          user_id: string;
        };
        Insert: {
          provider?: string;
          gateway_status?: string | null;
          gateway_short_code?: string | null;
          gateway_transaction_id?: string | null;
          amount: number;
          created_at?: string;
          id?: string;
          method?: string;
          note?: string | null;
          reference?: string | null;
          review_note?: string | null;
          reviewed_at?: string | null;
          reviewed_by?: string | null;
          status?: string;
          user_id: string;
        };
        Update: {
          provider?: string;
          gateway_status?: string | null;
          gateway_short_code?: string | null;
          gateway_transaction_id?: string | null;
          amount?: number;
          created_at?: string;
          id?: string;
          method?: string;
          note?: string | null;
          reference?: string | null;
          review_note?: string | null;
          reviewed_at?: string | null;
          reviewed_by?: string | null;
          status?: string;
          user_id?: string;
        };
        Relationships: [];
      };
      wallet_rspay_orders: {
        Row: {
          deposit_id: string;
          user_id: string;
          request_id: string;
          amount: number;
          method: string;
          identity_address: string;
          callback_hash: string;
          callback_private: boolean;
          short_code: string | null;
          checkout_url: string | null;
          status: string;
          transaction_id: string | null;
          deferred_event: Json | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          deposit_id: string;
          user_id: string;
          request_id: string;
          amount: number;
          method: string;
          identity_address: string;
          callback_hash: string;
          callback_private?: boolean;
          short_code?: string | null;
          checkout_url?: string | null;
          status?: string;
          transaction_id?: string | null;
          deferred_event?: Json | null;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          short_code?: string | null;
          checkout_url?: string | null;
          status?: string;
          transaction_id?: string | null;
          deferred_event?: Json | null;
          updated_at?: string;
        };
        Relationships: [];
      };
      wallet_transactions: {
        Row: {
          amount: number;
          balance_after: number;
          created_at: string;
          created_by: string | null;
          id: string;
          note: string | null;
          reference: string | null;
          type: string;
          user_id: string;
        };
        Insert: {
          amount: number;
          balance_after: number;
          created_at?: string;
          created_by?: string | null;
          id?: string;
          note?: string | null;
          reference?: string | null;
          type: string;
          user_id: string;
        };
        Update: {
          amount?: number;
          balance_after?: number;
          created_at?: string;
          created_by?: string | null;
          id?: string;
          note?: string | null;
          reference?: string | null;
          type?: string;
          user_id?: string;
        };
        Relationships: [];
      };
    };
    Views: {
      [_ in never]: never;
    };
    Functions: {
      claim_svp_auto_result_checks: { Args: { _limit?: number }; Returns: Json };
      finish_svp_auto_result_check: {
        Args: { _exam_id: string; _lease_token: string; _outcome: string };
        Returns: boolean;
      };
      record_svp_auto_result_run: {
        Args: { _checked: number; _saved: number; _errors: number };
        Returns: undefined;
      };
      svp_result_automation_status: { Args: Record<PropertyKey, never>; Returns: Json };

      apply_verified_svp_exam_result: {
        Args: { _exam_id: string; _snapshot: Json; _result: string; _result_date: string };
        Returns: Json;
      };
      sync_svp_occupation_catalogue: {
        Args: { _items: Json };
        Returns: Json;
      };
      get_customer_portal: { Args: never; Returns: Json };
      verify_appointment_scan: {
        Args: {
          _extraction_id: string;
          _exam_date: string;
          _exam_time: string;
          _reporting_time: string | null;
          _reason: string | null;
        };
        Returns: boolean;
      };
      set_rspay_gateway_control: { Args: { _control: string; _enabled: boolean }; Returns: Json };
      wallet_rspay_begin: {
        Args: {
          _user_id: string;
          _request_id: string;
          _amount: number;
          _method: string;
          _identity: string;
          _callback_hash: string;
        };
        Returns: Json;
      };
      wallet_rspay_bind: {
        Args: {
          _deposit_id: string;
          _short_code: string;
          _url: string;
          _callback_private?: boolean;
        };
        Returns: Json;
      };
      wallet_rspay_event: {
        Args: { _deposit_id: string; _callback_hash: string; _event: Json; _verified?: boolean };
        Returns: Json;
      };
      wallet_rspay_link_failed: { Args: { _deposit_id: string }; Returns: undefined };

      candidate_fee_settled: {
        Args: { _candidate_id: string };
        Returns: boolean;
      };
      check_applicant_result: {
        Args: { _occupation_id: string; _passport: string };
        Returns: Json;
      };
      claim_device_session: { Args: { _key: string }; Returns: undefined };
      current_customer_mobile: { Args: never; Returns: string };
      gen_ref_code: { Args: never; Returns: string };
      has_role: {
        Args: {
          _role: Database["public"]["Enums"]["app_role"];
          _user_id: string;
        };
        Returns: boolean;
      };
      has_role_text: {
        Args: { _role: string; _user_id: string };
        Returns: boolean;
      };
      is_active_account: { Args: { _user_id: string }; Returns: boolean };
      is_current_device_session: { Args: { _key: string }; Returns: boolean };
      is_management_user: { Args: { _user_id: string }; Returns: boolean };
      is_staff: { Args: { _user_id: string }; Returns: boolean };
      parent_agent_of: { Args: { _user_id: string }; Returns: string };
      passport_history: {
        Args: { _passport: string };
        Returns: {
          blocking: boolean;
          created_at: string;
          exam_at: string;
          occupation: string;
          ref_code: string;
          status: string;
          svp_result: string;
        }[];
      };
      portal_agent_contact: { Args: never; Returns: Json };
      verify_cron_token: {
        Args: { _name: string; _token: string };
        Returns: boolean;
      };
      cancel_stale_svp_bookings: {
        Args: { _minutes?: number };
        Returns: number;
      };
      wallet_admin_adjust: {
        Args: { _amount: number; _note?: string; _user_id: string };
        Returns: Json;
      };
      wallet_charge_booking: {
        Args: { _amount?: number; _reservation_id: string };
        Returns: Json;
      };
      wallet_charge_cbt_result: {
        Args: { _reference: string };
        Returns: Json;
      };
      wallet_my_balance: {
        Args: Record<PropertyKey, never>;
        Returns: number;
      };
      wallet_review_deposit: {
        Args: { _approve: boolean; _deposit_id: string; _note?: string };
        Returns: Json;
      };
      wallet_request_deposit: {
        Args: {
          _amount: number;
          _method?: string;
          _note?: string;
          _reference?: string;
        };
        Returns: Json;
      };
    };
    Enums: {
      app_role: "admin" | "staff" | "agent" | "service_provider" | "management";
      exam_result: "PENDING" | "PASS" | "FAIL" | "ABSENT" | "CANCELLED";
    };
    CompositeTypes: {
      [_ in never]: never;
    };
  };
};

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">;

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">];

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R;
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] & DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R;
      }
      ? R
      : never
    : never;

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    keyof DefaultSchema["Tables"] | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I;
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I;
      }
      ? I
      : never
    : never;

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    keyof DefaultSchema["Tables"] | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U;
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U;
      }
      ? U
      : never
    : never;

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    keyof DefaultSchema["Enums"] | { schema: keyof DatabaseWithoutInternals },
  EnumName extends (DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never) = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never;

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    keyof DefaultSchema["CompositeTypes"] | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends (PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never) = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never;

export const Constants = {
  public: {
    Enums: {
      app_role: ["admin", "staff", "agent", "service_provider", "management"],
      exam_result: ["PENDING", "PASS", "FAIL", "ABSENT", "CANCELLED"],
    },
  },
} as const;
