"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.pdfService = void 0;
const pdfkit_1 = __importDefault(require("pdfkit"));
exports.pdfService = {
    generatePayslip(payslip, employee) {
        return new Promise((resolve, reject) => {
            const doc = new pdfkit_1.default({ margin: 50 });
            const chunks = [];
            doc.on('data', (chunk) => chunks.push(chunk));
            doc.on('end', () => resolve(Buffer.concat(chunks)));
            doc.on('error', reject);
            const months = ['January', 'February', 'March', 'April', 'May', 'June',
                'July', 'August', 'September', 'October', 'November', 'December'];
            // Header
            doc.fontSize(20).fillColor('#1e40af').text('DutyLaunch Solutions Private Limited', { align: 'center' });
            doc.fontSize(12).fillColor('#374151').text('HRMS Portal - Payslip', { align: 'center' });
            doc.moveDown(0.5);
            doc.moveTo(50, doc.y).lineTo(550, doc.y).stroke('#e5e7eb');
            doc.moveDown(0.5);
            // Pay Period
            doc.fontSize(14).fillColor('#1f2937').text(`Payslip for ${months[payslip.month - 1]} ${payslip.year}`, { align: 'center' });
            doc.moveDown(1);
            // Employee Info
            doc.fontSize(11).fillColor('#374151');
            const col1 = 50, col2 = 310;
            doc.text(`Employee Name: ${employee.fullName}`, col1);
            doc.text(`Employee Code: ${employee.employeeCode}`, col2, doc.y - 14);
            doc.moveDown(0.3);
            doc.text(`Designation: ${employee.designation}`, col1);
            doc.text(`Department: ${employee.department}`, col2, doc.y - 14);
            doc.moveDown(0.3);
            doc.text(`Working Days: ${payslip.workingDays}`, col1);
            doc.text(`Paid Days: ${payslip.paidDays}`, col2, doc.y - 14);
            doc.moveDown(1);
            // Salary Table
            doc.moveTo(50, doc.y).lineTo(550, doc.y).stroke('#e5e7eb');
            doc.moveDown(0.5);
            // Earnings
            doc.fontSize(12).fillColor('#1e40af').text('Earnings', col1);
            doc.text('Deductions', col2, doc.y - 14);
            doc.moveDown(0.3);
            doc.moveTo(50, doc.y).lineTo(550, doc.y).stroke('#e5e7eb');
            doc.moveDown(0.3);
            doc.fontSize(10).fillColor('#374151');
            const rows = [
                ['Basic Salary', payslip.basic, 'Provident Fund (PF)', payslip.pf],
                ['HRA', payslip.hra, 'ESI', payslip.esi],
                ['DA', payslip.da, 'TDS', payslip.tds],
                ['Special Allowance', payslip.specialAllowance, 'Other Deductions', payslip.otherDeductions],
                ['Other Allowances', payslip.otherAllowances, '', ''],
            ];
            rows.forEach(([earnLabel, earnVal, dedLabel, dedVal]) => {
                doc.text(`${earnLabel}`, col1);
                doc.text(`₹ ${Number(earnVal).toFixed(2)}`, col1 + 140, doc.y - 14, { width: 80, align: 'right' });
                if (dedLabel) {
                    doc.text(`${dedLabel}`, col2);
                    doc.text(`₹ ${Number(dedVal).toFixed(2)}`, col2 + 140, doc.y - 14, { width: 80, align: 'right' });
                }
                doc.moveDown(0.3);
            });
            doc.moveDown(0.3);
            doc.moveTo(50, doc.y).lineTo(550, doc.y).stroke('#e5e7eb');
            doc.moveDown(0.3);
            // Totals
            doc.fontSize(11).fillColor('#1f2937');
            doc.text(`Total Earnings: ₹ ${payslip.totalEarnings.toFixed(2)}`, col1);
            doc.text(`Total Deductions: ₹ ${payslip.totalDeductions.toFixed(2)}`, col2, doc.y - 14);
            doc.moveDown(1);
            // Net Salary
            doc.moveTo(50, doc.y).lineTo(550, doc.y).stroke('#1e40af');
            doc.moveDown(0.5);
            doc.fontSize(14).fillColor('#1e40af').text(`Net Salary: ₹ ${payslip.netSalary.toFixed(2)}`, { align: 'center' });
            doc.moveDown(1);
            // Footer
            doc.fontSize(9).fillColor('#6b7280');
            doc.text(`Generated on: ${new Date().toLocaleDateString('en-IN')}`, { align: 'center' });
            doc.text('This is a computer-generated document and does not require a signature.', { align: 'center' });
            doc.end();
        });
    },
    generateEmployeeCertificate(employee, type) {
        return new Promise((resolve, reject) => {
            const doc = new pdfkit_1.default({ margin: 50 });
            const chunks = [];
            doc.on('data', (chunk) => chunks.push(chunk));
            doc.on('end', () => resolve(Buffer.concat(chunks)));
            doc.on('error', reject);
            doc.fontSize(20).fillColor('#1e40af').text('DutyLaunch Solutions Private Limited', { align: 'center' });
            doc.moveDown(0.5);
            doc.fontSize(16).fillColor('#1f2937').text(`${type}`, { align: 'center', underline: true });
            doc.moveDown(1.5);
            doc.fontSize(11).fillColor('#374151');
            doc.text(`To Whomsoever It May Concern,`, { align: 'left' });
            doc.moveDown(0.5);
            doc.text(`This is to certify that ${employee.fullName} (Employee Code: ${employee.employeeCode}) is/was employed at DutyLaunch Solutions Private Limited as ${employee.designation} in the ${employee.department} department.`);
            doc.moveDown(0.5);
            doc.text(`Date of Joining: ${employee.dateOfJoining.toLocaleDateString('en-IN')}`);
            if (employee.dateOfExit) {
                doc.moveDown(0.3);
                doc.text(`Date of Exit: ${employee.dateOfExit.toLocaleDateString('en-IN')}`);
            }
            doc.moveDown(2);
            doc.text('For DutyLaunch Solutions Private Limited');
            doc.moveDown(2);
            doc.text('Authorized Signatory');
            doc.moveDown(0.5);
            doc.text('HR Department');
            doc.moveDown(1);
            doc.fontSize(9).fillColor('#6b7280').text(`Generated on: ${new Date().toLocaleDateString('en-IN')}`, { align: 'center' });
            doc.end();
        });
    },
};
//# sourceMappingURL=pdfService.js.map