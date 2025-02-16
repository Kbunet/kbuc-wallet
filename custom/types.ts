
export type Difficulty = {
    amount: number;
    time: number;
    address: string;
  }
  
export type SupportServerType = {
    host: string;
    port?: number;
    isDefault?: boolean;
    difficulties?: Difficulty[]
  };