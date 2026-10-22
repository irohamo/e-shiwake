import { parse } from 'csv-parse/sync';
import { createHash } from 'node:crypto';
import { z } from 'zod';
import type { CsvInput, ImportedTransaction } from './workflow-schema';
export function parseCsv(input: CsvInput): ImportedTransaction[] {
	if (Buffer.byteLength(input.csv, 'utf8') > 60000)
		throw new Error('UTF-8換算60KB以下に分割してください');
	const rows = parse(input.csv, {
		columns: (columns: string[]) => {
			if (
				columns.length > 60 ||
				columns.some((c) => c.length > 100) ||
				new Set(columns).size !== columns.length
			)
				throw new Error('CSVヘッダーが重複または長すぎます');
			return columns;
		},
		bom: true,
		skip_empty_lines: true,
		max_record_size: 16000
	}) as Record<string, string>[];
	if (!rows.length || rows.length > 500) throw new Error('CSVは1〜500行に分割してください');
	for (const key of Object.values(input.mapping))
		if (key && !Object.hasOwn(rows[0], key)) throw new Error('指定された列がCSVに存在しません');
	const seen = new Set<string>();
	return rows.map((raw, index) => {
		const cell = (key: string | undefined) =>
			key ? (Object.hasOwn(raw, key) ? raw[key].trim() : undefined) : '';
		const originalDate = cell(input.mapping.date);
		let text = cell(input.mapping.amount);
		if (!input.mapping.amount) {
			const incoming = cell(input.mapping.inflow) || '0';
			const outgoing = cell(input.mapping.outflow) || '0';
			const positive = /^(?:\d+|\d{1,3}(?:,\d{3})+)$/;
			if (
				(!input.mapping.inflow && !input.mapping.outflow) ||
				!positive.test(incoming) ||
				!positive.test(outgoing)
			)
				throw new Error(`${index + 2}行目: 入金・出金列の整数金額を確認してください`);
			const plus = Number(incoming.replaceAll(',', ''));
			const minus = Number(outgoing.replaceAll(',', ''));
			if (!Number.isSafeInteger(plus) || !Number.isSafeInteger(minus) || (plus > 0 && minus > 0))
				throw new Error(`${index + 2}行目: 入出金の両方を同時指定できません`);
			text = String(plus - minus);
		}
		if (
			originalDate === undefined ||
			text === undefined ||
			cell(input.mapping.description) === undefined
		)
			throw new Error('列の指定がCSVに存在しません');
		const match = /^(\d{4})[/-](\d{1,2})[/-](\d{1,2})$/.exec(originalDate);
		const date = match
			? `${match[1]}-${match[2].padStart(2, '0')}-${match[3].padStart(2, '0')}`
			: '';
		if (!z.iso.date().safeParse(date).success)
			throw new Error(`${index + 2}行目: 日付を確認してください`);
		if (!/^[+-]?(?:\d+|\d{1,3}(?:,\d{3})+)$/.test(text))
			throw new Error(`${index + 2}行目: 金額は整数円で指定してください`);
		let amount = Number(text.replaceAll(',', ''));
		if (!Number.isSafeInteger(amount) || amount === 0 || Math.abs(amount) > 1e12)
			throw new Error(`${index + 2}行目: 金額範囲が不正です`);
		if (input.mapping.amount && input.direction === 'expense') amount = -amount;
		const description = cell(input.mapping.description) || '';
		const vendor = cell(input.mapping.vendor) || '';
		const externalId = cell(input.mapping.externalId) || '';
		if (!description || description.length > 2000 || vendor.length > 500 || externalId.length > 500)
			throw new Error(`${index + 2}行目: 摘要・取引先・明細IDを確認してください`);
		const identity = externalId
			? [input.source, input.account, 'id', externalId]
			: [input.source, input.account, date, amount, description, vendor];
		const fingerprint = createHash('sha256').update(JSON.stringify(identity)).digest('hex');
		if (seen.has(fingerprint))
			throw new Error(
				`${index + 2}行目: ファイル内に同じ明細があります。別取引なら固有の明細IDを指定してください`
			);
		seen.add(fingerprint);
		return {
			fingerprint,
			date,
			amount,
			description,
			vendor,
			externalId,
			source: input.source,
			account: input.account,
			raw
		};
	});
}
