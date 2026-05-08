declare module "nodemailer" {
  export interface SendMailOptions {
    from?: string;
    to?: string;
    replyTo?: string;
    subject?: string;
    text?: string;
  }

  export interface Transporter {
    sendMail(options: SendMailOptions): Promise<unknown>;
  }

  const nodemailer: {
    createTransport(options: unknown): Transporter;
  };

  export default nodemailer;
}
