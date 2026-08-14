import express, { type Express } from "express";
import {
  APPLICATION_FORM_LIMIT,
  APPLICATION_JSON_LIMIT,
} from "./httpRuntimePolicy";

export interface ApplicationBodyParserLimits {
  json?: string | number;
  form?: string | number;
}

export function registerApplicationBodyParsers(
  app: Express,
  limits: ApplicationBodyParserLimits = {}
) {
  app.use(express.json({ limit: limits.json ?? APPLICATION_JSON_LIMIT }));
  app.use(
    express.urlencoded({
      limit: limits.form ?? APPLICATION_FORM_LIMIT,
      extended: true,
    })
  );
}
