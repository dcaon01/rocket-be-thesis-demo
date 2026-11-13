import { Injectable } from "@nestjs/common";
import { StructureField } from "../../classes/structured-field.class";
import { TypeEnum } from "../../enums/type.enum";

@Injectable()
export class StructureTypeCheckService {
  /**
   * Checks if the given object matches the provided structure.
   * @param object the object to check.
   * @param structure the structure to check against.
   * @return true if the object matches the structure, false otherwise.
   */
  checkType(object: Record<string, unknown>, structure: StructureField[]): boolean {
    for (const field of structure) {
      const value: unknown = object[field.name];

      // Check required fields
      if (field.required && (value === undefined || value === null)) {
        return false;
      }

      if (!field.required && (value === undefined || value === null)) {
        continue; // Skip optional fields if not present
      }

      // Validate the type
      if (!this.validateFieldType(value, field)) {
        return false;
      }
    }

    return true;
  }

  /**
   * Validates if a value matches the expected field type.
   * @param value the value to validate.
   * @param field the field definition containing type and array information.
   * @return true if the value matches the field type, false otherwise.
   */
  private validateFieldType(value: any, field: StructureField): boolean {
    // Handle array types
    if (field.array) {
      if (!Array.isArray(value)) {
        return false;
      }
      // Check each element in the array
      return value.every(item => this.matchesType(item, field.type));
    }

    // Handle non-array types
    return this.matchesType(value, field.type);
  }

  /**
   * Checks if a value matches a specific TypeEnum.
   * @param value the value to check.
   * @param type the expected type from TypeEnum.
   * @return true if the value matches the specified type, false otherwise.
   */
  private matchesType(value: any, type: TypeEnum): boolean {
    switch (type) {
      case TypeEnum.String:
        return typeof value === 'string';
      case TypeEnum.Number:
        return typeof value === 'number' && !isNaN(value);
      case TypeEnum.Boolean:
        return typeof value === 'boolean';
      case TypeEnum.Object:
        return typeof value === 'object' && value !== null && !Array.isArray(value);
      default:
        return false;
    }
  }
}
